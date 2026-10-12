import { goBack } from '../src/utils/navigation';
import { exportName } from '../src/utils/exportName';
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Platform,
  Modal,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { enrollmentAPI, attendanceAPI, lecturesAPI } from '../src/services/api';
import api from '../src/services/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useOfflineSyncStore } from '../src/store/offlineSyncStore';
import { useAuthStore } from '../src/store/authStore';
import { LoadingScreen } from '../src/components/LoadingScreen';
import { useAuth, PERMISSIONS, PermissionGate } from '../src/contexts/AuthContext';
import OfflineIndicator from '../src/components/OfflineIndicator';
import { formatGregorianDate, formatHijriDate, parseDate, WEEKDAYS_AR } from '../src/utils/dateUtils';

interface EnrolledStudent {
  id: string;
  student_id: string;
  full_name: string;
  attendance_status: string | null;
}

interface LectureDetails {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  room: string;
  status: string;
  group?: string;
  group_name?: string;
}

interface CourseDetails {
  id: string;
  name: string;
  code: string;
}

export default function TakeAttendanceScreen() {
  const router = useRouter();
  const { lectureId, courseId, courseName } = useLocalSearchParams();
  
  // استخدام store الأوفلاين الجديد
  const { 
    isOnline, 
    addAttendanceRecord, 
    getPendingRecordsCount,
    cacheLecture,
    cacheStudents,
    getCachedLecture,
    getCachedStudents,
    startNetworkMonitoring,
    loadFromStorage,
  } = useOfflineSyncStore();
  
  const { hasPermission, user: authUser, isLoading: authLoading } = useAuth();
  const user = useAuthStore((state) => state.user);
  
  // الطالب لا يمكنه الوصول لهذه الصفحة
  const isStudent = user?.role === 'student' || authUser?.role === 'student';
  
  // المعلم فقط يمكنه تسجيل الحضور - ليس المدير
  const canRecordAttendance = !isStudent && (hasPermission(PERMISSIONS.RECORD_ATTENDANCE) || 
                              hasPermission(PERMISSIONS.TAKE_ATTENDANCE) || 
                              user?.role === 'teacher');
  // تعديل الحضور يتطلب صلاحية edit_attendance صراحة
  const canEditAttendance = hasPermission(PERMISSIONS.EDIT_ATTENDANCE);
  
  // إعادة توجيه الطالب
  useEffect(() => {
    if (!authLoading && isStudent) {
      router.replace('/');
    }
  }, [isStudent, authLoading]);
  
  const [lecture, setLecture] = useState<LectureDetails | null>(null);
  const [course, setCourse] = useState<CourseDetails | null>(null);
  const [students, setStudents] = useState<EnrolledStudent[]>([]);
  const [attendance, setAttendance] = useState<{ [key: string]: string }>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [attendanceRecorded, setAttendanceRecorded] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);

  // === ربط الخطة الدراسية ===
  const [showLessonModal, setShowLessonModal] = useState(false);
  const [lessonTitle, setLessonTitle] = useState('');
  const [planTopicId, setPlanTopicId] = useState<string | null>(null);
  const [studyPlan, setStudyPlan] = useState<any>(null);
  const [savingLesson, setSavingLesson] = useState(false);

  // 🆕 طلبات اعتماد معلّقة لهذه المحاضرة (شارة ⏳)
  const [pendingByStudent, setPendingByStudent] = useState<Record<string, { id: string; new_status: string }>>({});
  const isDean = user?.role === 'dean' || authUser?.role === 'dean';
  const isAdmin = user?.role === 'admin' || authUser?.role === 'admin';
  const needsApprovalMode = !isDean && !isAdmin && canEditAttendance && attendanceRecorded;

  const fetchPendingRequests = useCallback(async () => {
    if (!lectureId) return;
    try {
      const r = await api.get(`/attendance-changes/lecture/${lectureId}/pending`);
      const map: Record<string, { id: string; new_status: string }> = {};
      (r.data?.items || []).forEach((it: any) => {
        map[it.student_id] = { id: it.id, new_status: it.new_status };
      });
      setPendingByStudent(map);
    } catch (e) { /* silent */ }
  }, [lectureId]);
  useEffect(() => { fetchPendingRequests(); }, [fetchPendingRequests]);
  
  // بدء مراقبة الاتصال عند تحميل الصفحة
  useEffect(() => {
    loadFromStorage();
    const unsubscribe = startNetworkMonitoring();
    return () => unsubscribe();
  }, []);
  
  // حالة التحضير
  const [attendanceStatus, setAttendanceStatus] = useState<{
    can_take_attendance: boolean;
    reason: string;
    status: string;
    minutes_remaining?: number;
    deadline?: string;
  } | null>(null);

  // State لرسالة الخطأ
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);

  // تصدير PDF
  const handleExportPdf = async () => {
    if (!lectureId) return;
    setExportingPdf(true);
    try {
      const token = await AsyncStorage.getItem('token');
      const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || '';
      const url = `${backendUrl}/api/lectures/${lectureId}/pdf`;
      
      if (Platform.OS === 'web') {
        const response = await fetch(url, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!response.ok) throw new Error('فشل تحميل التقرير');
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        const xf = response.headers.get('x-filename');
        a.download = xf ? decodeURIComponent(xf) : exportName(['كشف حضور محاضرة', course?.name || courseName, lecture?.date], 'pdf');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(blobUrl);
      } else {
        Alert.alert('تنبيه', 'تصدير PDF متاح فقط على الويب حالياً');
      }
    } catch (error) {
      console.error('PDF export error:', error);
      if (Platform.OS === 'web') {
        window.alert('فشل في تصدير التقرير');
      } else {
        Alert.alert('خطأ', 'فشل في تصدير التقرير');
      }
    } finally {
      setExportingPdf(false);
    }
  };

  const fetchData = useCallback(async () => {
    setErrorMessage(null);
    try {
      if (lectureId) {
        // محاولة جلب البيانات من الخادم أولاً
        try {
          const response = await lecturesAPI.getDetails(lectureId as string);
          const data = response.data;
          
          setLecture(data.lecture);
          setCourse(data.course);
          setStudents(data.students);
          setAttendanceRecorded(data.attendance_recorded);
          setOfflineMode(false);
          
          // تخزين البيانات محلياً للاستخدام أوفلاين (مع حالة الحضور)
          await cacheLecture({
            id: data.lecture.id,
            course_id: data.course.id,
            course_name: data.course.name,
            date: data.lecture.date,
            start_time: data.lecture.start_time,
            end_time: data.lecture.end_time,
            room: data.lecture.room,
            attendance_recorded: data.attendance_recorded,
            students: data.students.map((s: EnrolledStudent) => ({
              id: s.id,
              student_id: s.student_id,
              full_name: s.full_name,
              attendance_status: s.attendance_status,
            })),
            cached_at: new Date().toISOString(),
          });
          
          // جلب حالة التحضير
          if (data.attendance_status) {
            setAttendanceStatus(data.attendance_status);
          } else {
            try {
              const statusRes = await lecturesAPI.getAttendanceStatus(lectureId as string);
              setAttendanceStatus(statusRes.data);
            } catch (e) {
              console.log('Error fetching attendance status:', e);
            }
          }
            
            // Initialize attendance
            const initialAttendance: { [key: string]: string } = {};
            data.students.forEach((s: EnrolledStudent) => {
              initialAttendance[s.id] = s.attendance_status || 'present';
            });
            setAttendance(initialAttendance);
          } catch (error: any) {
            // فشل الاتصال - عرض رسالة خطأ واضحة مع إمكانية إعادة المحاولة
            console.log('فشل الاتصال:', error?.response?.status, error?.message);
            loadCachedData(error);
          }
      } else if (courseId) {
        // Old way: fetch enrolled students for a course (fallback)
        const enrolledRes = await enrollmentAPI.getEnrolledStudents(courseId as string);
        setStudents(enrolledRes.data.map((s: any) => ({
          id: s.id,
          student_id: s.student_id,
          full_name: s.full_name,
          attendance_status: null
        })));
        
        // Initialize all as present
        const initialAttendance: { [key: string]: string } = {};
        enrolledRes.data.forEach((s: any) => {
          initialAttendance[s.id] = 'present';
        });
        setAttendance(initialAttendance);
      }
    } catch (error: any) {
      console.error('Error fetching data:', error);
      // محاولة استخدام البيانات المخزنة مع تمرير الخطأ
      loadCachedData(error);
    } finally {
      setLoading(false);
    }
  }, [lectureId, courseId]);

  // دالة تحميل البيانات المخزنة
  const loadCachedData = (apiError?: any) => {
    const cachedLecture = getCachedLecture(lectureId as string);
    if (cachedLecture) {
      setLecture({
        id: cachedLecture.id,
        date: cachedLecture.date,
        start_time: cachedLecture.start_time,
        end_time: cachedLecture.end_time,
        room: cachedLecture.room || '',
        status: 'cached',
      });
      setCourse({
        id: cachedLecture.course_id,
        name: cachedLecture.course_name,
        code: '',
      });
      setStudents(cachedLecture.students.map(s => ({
        ...s,
        attendance_status: s.attendance_status || null,
      })));
      setOfflineMode(true);
      setAttendanceRecorded(cachedLecture.attendance_recorded || false);
      
      // تحميل الحضور المحفوظ من الكاش
      const initialAttendance: { [key: string]: string } = {};
      cachedLecture.students.forEach((s: any) => {
        initialAttendance[s.id] = s.attendance_status || 'present';
      });
      setAttendance(initialAttendance);
      
      // السماح بالتحضير أوفلاين
      setAttendanceStatus({
        can_take_attendance: true,
        reason: 'وضع أوفلاين - سيتم المزامنة عند عودة الاتصال',
        status: 'offline',
      });
    } else {
      // عرض رسالة خطأ واضحة مع إمكانية إعادة المحاولة
      const status = apiError?.response?.status;
      const errorMsg = status === 404
        ? 'المحاضرة غير موجودة أو تم حذفها'
        : status === 401 || status === 403
        ? 'انتهت الجلسة. يرجى تسجيل الدخول مرة أخرى'
        : status >= 500
        ? 'خطأ في الخادم. يرجى المحاولة لاحقاً'
        : 'فشل في تحميل بيانات المحاضرة. تأكد من اتصالك بالإنترنت وأعد المحاولة';
      setErrorMessage(errorMsg);
    }
  };

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const toggleStatus = (studentId: string) => {
    // التحقق من إمكانية التحضير - تجاوز القيد الزمني إذا كان لدى المستخدم صلاحية تعديل الحضور
    if (attendanceStatus && !attendanceStatus.can_take_attendance && !canEditAttendance) {
      const msg = attendanceStatus.reason || 'لا يمكن تسجيل الحضور حالياً';
      if (Platform.OS === 'web') {
        window.alert(msg);
      } else {
        Alert.alert('غير مسموح', msg);
      }
      return;
    }
    
    // التحقق من الصلاحية
    if (!canRecordAttendance && !canEditAttendance) {
      Alert.alert('تنبيه', 'ليس لديك صلاحية لتعديل الحضور');
      return;
    }
    
    // 📐 اللائحة: الأستاذ لا يسجّل «بعذر» — العذر عبر طلب معتمد فقط (الإدارة تحتفظ به كأداة تصحيح)
    const isTeacherUser = user?.role === 'teacher' || authUser?.role === 'teacher';
    const statuses = isTeacherUser ? ['present', 'absent'] : ['present', 'absent', 'excused'];
    const currentIndex = Math.max(0, statuses.indexOf(attendance[studentId]));
    const nextIndex = (currentIndex + 1) % statuses.length;
    setAttendance({ ...attendance, [studentId]: statuses[nextIndex] });
  };

  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'present':
        return { bg: '#e8f5e9', color: '#4caf50', label: 'حاضر' };
      case 'absent':
        return { bg: '#ffebee', color: '#f44336', label: 'غائب' };
      case 'excused':
        return { bg: '#fff3e0', color: '#ff9800', label: 'معذور' };
      default:
        return { bg: '#f5f5f5', color: '#999', label: 'غير محدد' };
    }
  };

  // تحديث الكاش بحالة الحضور الحالية
  const updateCacheWithAttendance = async () => {
    if (!lectureId || !course) return;
    const updatedStudents = students.map(s => ({
      id: s.id,
      student_id: s.student_id,
      full_name: s.full_name,
      attendance_status: attendance[s.id] || null,
    }));
    await cacheLecture({
      id: lectureId as string,
      course_id: course.id,
      course_name: course.name,
      date: lecture?.date || '',
      start_time: lecture?.start_time || '',
      end_time: lecture?.end_time || '',
      room: lecture?.room,
      attendance_recorded: true,
      students: updatedStudents,
      cached_at: new Date().toISOString(),
    });
  };

  // جلب الخطة الدراسية أول مرة لاستخدامها في modal الموضوع
  const fetchStudyPlan = useCallback(async () => {
    if (!course?.id && !courseId) return;
    try {
      const cid = course?.id || (courseId as string);
      const res = await api.get(`/courses/${cid}/study-plan`);
      setStudyPlan(res.data);
    } catch {
      setStudyPlan(null);
    }
  }, [course?.id, courseId]);

  useEffect(() => {
    if (course?.id) fetchStudyPlan();
  }, [course?.id, fetchStudyPlan]);

  // فتح modal اختيار الموضوع قبل حفظ الحضور
  const promptForLessonAndSave = () => {
    if (Object.keys(attendance).length === 0) {
      const msg = 'يرجى تسجيل الحضور لجميع الطلاب أولاً';
      if (Platform.OS === 'web') window.alert(msg); else Alert.alert('تنبيه', msg);
      return;
    }
    setLessonTitle('');
    setPlanTopicId(null);
    setShowLessonModal(true);
  };

  const saveAttendance = async () => {
    setSaving(true);
    try {
      const records = Object.entries(attendance).map(([studentId, status]) => ({
        student_id: studentId,
        status,
      }));

      if (isOnline && !offlineMode) {
        // أونلاين - حفظ مباشر على الخادم
        if (lectureId) {
          const resp: any = await attendanceAPI.recordSession({
            lecture_id: lectureId as string,
            records,
            lesson_title: lessonTitle.trim() || undefined,
            plan_topic_id: planTopicId || undefined,
          } as any);
          // 🆕 مسار اعتماد العميد
          if (resp?.data?.status === 'pending_approval') {
            const cnt = resp.data.created ?? records.length;
            const msg = `تم إرسال ${cnt} تعديل لاعتماد العميد`;
            if (Platform.OS === 'web') { window.alert(msg); goBack(); }
            else { Alert.alert('بانتظار الاعتماد', msg, [{ text: 'حسناً', onPress: () => goBack() }]); }
            return;
          }
        }
        
        // تحديث الكاش بالحضور المحفوظ
        await updateCacheWithAttendance();
        
        const successMsg = 'تم حفظ الحضور بنجاح';
        if (Platform.OS === 'web') {
          window.alert(successMsg);
          goBack();
        } else {
          Alert.alert('نجاح', successMsg, [
            { text: 'حسناً', onPress: () => goBack() }
          ]);
        }
      } else {
        // أوفلاين - حفظ محلي مع المزامنة لاحقاً
        const student_names: Record<string, string> = {};
        students.forEach(s => { student_names[s.id] = s.full_name; });
        
        for (const [studentId, status] of Object.entries(attendance)) {
          await addAttendanceRecord({
            lecture_id: lectureId as string,
            course_id: course?.id || courseId as string,
            student_id: studentId,
            student_name: student_names[studentId],
            status: status as 'present' | 'absent' | 'late' | 'excused',
            method: 'manual_offline',
          });
        }
        
        const pendingCount = getPendingRecordsCount();
        
        // تحديث الكاش بالحضور المحفوظ أوفلاين
        await updateCacheWithAttendance();
        
        const offlineMsg = `تم حفظ الحضور محلياً (${pendingCount} سجل معلق)\nسيتم المزامنة تلقائياً عند عودة الاتصال`;
        
        if (Platform.OS === 'web') {
          window.alert(offlineMsg);
          goBack();
        } else {
          Alert.alert('تم الحفظ أوفلاين', offlineMsg, [
            { text: 'حسناً', onPress: () => goBack() }
          ]);
        }
      }
    } catch (error: any) {
      console.error('Error saving attendance:', error);
      
      // التحقق: هل الخطأ من الخادم (مثل "لم يحن وقت المحاضرة") أم فشل اتصال حقيقي
      const serverError = error?.response?.data?.detail;
      const statusCode = error?.response?.status;
      
      if (serverError && (statusCode === 400 || statusCode === 403)) {
        // خطأ من الخادم - عرض الرسالة الفعلية (مثل: لم يحن وقت المحاضرة)
        if (Platform.OS === 'web') {
          window.alert(serverError);
        } else {
          Alert.alert('غير مسموح', serverError);
        }
      } else {
        // فشل اتصال حقيقي - حفظ أوفلاين
        try {
          const student_names: Record<string, string> = {};
          students.forEach(s => { student_names[s.id] = s.full_name; });
          
          for (const [studentId, status] of Object.entries(attendance)) {
            await addAttendanceRecord({
              lecture_id: lectureId as string,
              course_id: course?.id || courseId as string,
              student_id: studentId,
              student_name: student_names[studentId],
              status: status as 'present' | 'absent' | 'late' | 'excused',
              method: 'manual_offline',
            });
          }
          
          const fallbackMsg = 'تم حفظ الحضور محلياً (فشل الاتصال بالخادم)';
          // تحديث الكاش بالحضور الأوفلاين
          await updateCacheWithAttendance();
          if (Platform.OS === 'web') {
            window.alert(fallbackMsg);
            goBack();
          } else {
            Alert.alert('تم الحفظ', fallbackMsg, [
              { text: 'حسناً', onPress: () => goBack() }
            ]);
          }
        } catch (offlineError) {
          const errorMsg = 'فشل في حفظ الحضور';
          if (Platform.OS === 'web') {
            window.alert(errorMsg);
          } else {
            Alert.alert('خطأ', errorMsg);
          }
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const renderStudent = ({ item, index }: { item: EnrolledStudent; index: number }) => {
    const status = attendance[item.id] || 'present';
    const statusStyle = getStatusStyle(status);
    const pending = pendingByStudent[item.id];  // 🆕 طلب اعتماد معلّق لهذا الطالب

    return (
      <TouchableOpacity
        style={styles.studentCard}
        onPress={() => toggleStatus(item.id)}
        data-testid={`student-row-${item.student_id}`}
      >
        <Text style={styles.studentIndex}>{index + 1}</Text>
        <View style={styles.studentInfo}>
          <Text style={styles.studentName}>{item.full_name}</Text>
          <Text style={styles.studentId}>{item.student_id}</Text>
        </View>
        {pending && (
          <View style={styles.pendingBadge} data-testid={`pending-badge-${item.student_id}`}>
            <Text style={styles.pendingText}>⏳ بانتظار اعتماد → {getStatusStyle(pending.new_status).label}</Text>
          </View>
        )}
        <View style={[styles.statusBadge, { backgroundColor: statusStyle.bg }]}>
          <Text style={[styles.statusText, { color: statusStyle.color }]}>
            {statusStyle.label}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return <LoadingScreen />;
  }

  const presentCount = Object.values(attendance).filter(s => s === 'present').length;
  const absentCount = Object.values(attendance).filter(s => s === 'absent').length;
  const excusedCount = Object.values(attendance).filter(s => s === 'excused').length;

  const displayName = course?.name || courseName || 'المقرر';
  const displayDate = lecture?.date ? formatGregorianDate(parseDate(lecture.date), { includeWeekday: true }) : formatGregorianDate(new Date(), { includeWeekday: true });
  
  // التحقق من إمكانية التحضير
  const canTakeAttendanceNow = attendanceStatus?.can_take_attendance !== false;

  return (
    <>
      <Stack.Screen
        options={{
          title: 'تسجيل الحضور',
          headerBackTitle: 'رجوع',
        }}
      />
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        {errorMessage ? (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.pageScroll, { flexGrow: 1, justifyContent: 'center' }]}>
            <View style={styles.errorCard} data-testid="attendance-error-container">
              <View style={styles.errorIconWrap}>
                <Ionicons name="alert-circle" size={48} color="#f44336" />
              </View>
              <Text style={styles.errorTitle}>تعذر تحميل البيانات</Text>
              <Text style={styles.errorText} data-testid="attendance-error-message">{errorMessage}</Text>
              <View style={{ flexDirection: 'row-reverse', gap: 10, marginTop: 16 }}>
                <TouchableOpacity
                  style={styles.errorPrimaryBtn}
                  data-testid="attendance-retry-btn"
                  onPress={() => { setErrorMessage(null); setLoading(true); fetchData(); }}
                >
                  <Ionicons name="refresh" size={18} color="#fff" />
                  <Text style={styles.errorPrimaryBtnText}>إعادة المحاولة</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.errorGhostBtn}
                  data-testid="attendance-back-btn"
                  onPress={() => goBack()}
                >
                  <Ionicons name="arrow-back" size={18} color="#1565c0" />
                  <Text style={styles.errorGhostBtnText}>العودة</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        ) : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.pageScroll, { flexGrow: 1 }]} showsVerticalScrollIndicator={true}>

            {/* Page header */}
            <View style={styles.pageHeader}>
              <View style={styles.pageHeaderRight}>
                <Text style={styles.pageTitle}>تسجيل الحضور</Text>
                <View style={styles.breadcrumb}>
                  <TouchableOpacity onPress={() => router.replace('/')}>
                    <Text style={styles.breadcrumbLink}>الرئيسية</Text>
                  </TouchableOpacity>
                  <Ionicons name="chevron-back" size={12} color="#8a95a8" />
                  <TouchableOpacity onPress={() => router.replace('/schedule' as any)}>
                    <Text style={styles.breadcrumbLink}>الجدول</Text>
                  </TouchableOpacity>
                  <Ionicons name="chevron-back" size={12} color="#8a95a8" />
                  <Text style={styles.breadcrumbCurrent} numberOfLines={1}>{displayName}</Text>
                </View>
              </View>
              <View style={styles.pageHeaderActions}>
                <TouchableOpacity style={[styles.headerBtn, styles.btnGhost]} onPress={() => goBack()}>
                  <Ionicons name="arrow-back" size={15} color="#1a2540" />
                  <Text style={styles.btnGhostText}>رجوع</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* 🆕 تنبيه وضع اعتماد العميد */}
            {needsApprovalMode && (
              <View style={styles.approvalBanner} data-testid="approval-mode-banner">
                <Text style={styles.approvalBannerText}>
                  ⏳ أنت تعدّل خارج مهلة التحضير — أي تغيير سيُرسَل لاعتماد العميد قبل التطبيق
                </Text>
              </View>
            )}

            {/* Course Info Card */}
            <View style={styles.courseCard}>
              <View style={[styles.courseIconWrap]}>
                <Ionicons name="book" size={28} color="#fff" />
              </View>
              <View style={{ flex: 1, alignItems: 'flex-end' }}>
                <Text style={styles.courseTitle} numberOfLines={2}>{displayName}</Text>
                {lecture && (
                  <View style={styles.lectureMetaRow}>
                    <View style={styles.lectureMetaChip}>
                      <Ionicons name="calendar" size={11} color="#1565c0" />
                      <Text style={styles.lectureMetaText}>
                        {WEEKDAYS_AR[parseDate(lecture.date).getDay()]} • {formatGregorianDate(parseDate(lecture.date), { includeYear: false })}
                      </Text>
                    </View>
                    <View style={styles.lectureMetaChip}>
                      <Ionicons name="moon" size={11} color="#8a95a8" />
                      <Text style={styles.lectureMetaText}>{formatHijriDate(parseDate(lecture.date))}</Text>
                    </View>
                    <View style={styles.lectureMetaChip}>
                      <Ionicons name="time" size={11} color="#1565c0" />
                      <Text style={styles.lectureMetaText}>{lecture.start_time} - {lecture.end_time}</Text>
                    </View>
                    {lecture.room ? (
                      <View style={styles.lectureMetaChip}>
                        <Ionicons name="location" size={11} color="#ef6c00" />
                        <Text style={styles.lectureMetaText}>{lecture.room}</Text>
                      </View>
                    ) : null}
                    {lecture.group ? (
                      <View style={[styles.lectureMetaChip, { backgroundColor: '#e0f2f1' }]} testID="attendance-group-badge">
                        <Ionicons name="people" size={11} color="#00838f" />
                        <Text style={[styles.lectureMetaText, { color: '#00695c', fontWeight: '800' }]}>{lecture.group_name || `مجموعة ${lecture.group}`}</Text>
                      </View>
                    ) : null}
                  </View>
                )}
                {offlineMode && (
                  <View style={[styles.statusPill, { backgroundColor: '#fff3e0' }]}>
                    <Ionicons name="cloud-offline" size={12} color="#ef6c00" />
                    <Text style={[styles.statusPillText, { color: '#ef6c00' }]}>وضع أوفلاين</Text>
                  </View>
                )}
              </View>
            </View>

            {/* Attendance status bar */}
            {attendanceStatus && (
              <View style={[
                styles.statusBar,
                { backgroundColor: attendanceStatus.can_take_attendance ? '#e8f5e9' :
                  attendanceStatus.status === 'completed' ? '#e3f2fd' : '#ffebee' }
              ]}>
                <Ionicons
                  name={attendanceStatus.can_take_attendance ? 'checkmark-circle' :
                        attendanceStatus.status === 'completed' ? 'lock-closed' : 'time-outline'}
                  size={18}
                  color={attendanceStatus.can_take_attendance ? '#2e7d32' :
                         attendanceStatus.status === 'completed' ? '#1565c0' : '#c62828'}
                />
                <Text style={[
                  styles.statusBarText,
                  { color: attendanceStatus.can_take_attendance ? '#2e7d32' :
                           attendanceStatus.status === 'completed' ? '#1565c0' : '#c62828' }
                ]}>
                  {attendanceStatus.reason}
                </Text>
                {attendanceStatus.minutes_remaining && (
                  <Text style={styles.statusBarDeadline}>
                    (متبقي {attendanceStatus.minutes_remaining} دقيقة)
                  </Text>
                )}
              </View>
            )}

            {attendanceRecorded && !attendanceStatus && (
              <View style={[styles.statusBar, { backgroundColor: '#e8f5e9' }]}>
                <Ionicons name="checkmark-circle" size={18} color="#2e7d32" />
                <Text style={[styles.statusBarText, { color: '#2e7d32' }]}>تم تسجيل الحضور مسبقاً</Text>
              </View>
            )}

            {/* Stats grid */}
            <View style={styles.statsGrid}>
              <View style={styles.statCard}>
                <View style={[styles.statIconWrap, { backgroundColor: '#1a237e' }]}><Ionicons name="people" size={22} color="#fff" /></View>
                <View style={styles.statTextCol}>
                  <Text style={styles.statLabel}>إجمالي الطلاب</Text>
                  <Text style={styles.statValue}>{students.length}</Text>
                  <Text style={styles.statSubLabel}>مسجل</Text>
                </View>
              </View>
              <View style={styles.statCard}>
                <View style={[styles.statIconWrap, { backgroundColor: '#2e7d32' }]}><Ionicons name="checkmark-circle" size={22} color="#fff" /></View>
                <View style={styles.statTextCol}>
                  <Text style={styles.statLabel}>حاضر</Text>
                  <Text style={[styles.statValue, { color: '#2e7d32' }]}>{presentCount}</Text>
                  <Text style={styles.statSubLabel}>طالب</Text>
                </View>
              </View>
              <View style={styles.statCard}>
                <View style={[styles.statIconWrap, { backgroundColor: '#c62828' }]}><Ionicons name="close-circle" size={22} color="#fff" /></View>
                <View style={styles.statTextCol}>
                  <Text style={styles.statLabel}>غائب</Text>
                  <Text style={[styles.statValue, { color: '#c62828' }]}>{absentCount}</Text>
                  <Text style={styles.statSubLabel}>طالب</Text>
                </View>
              </View>
              <View style={styles.statCard}>
                <View style={[styles.statIconWrap, { backgroundColor: '#ef6c00' }]}><Ionicons name="alert-circle" size={22} color="#fff" /></View>
                <View style={styles.statTextCol}>
                  <Text style={styles.statLabel}>معذور</Text>
                  <Text style={[styles.statValue, { color: '#ef6c00' }]}>{excusedCount}</Text>
                  <Text style={styles.statSubLabel}>طالب</Text>
                </View>
              </View>
            </View>

            {/* Action toolbar */}
            {lectureId && (
              <View style={styles.toolbarCard}>
                <TouchableOpacity
                  style={[styles.toolBtn, { backgroundColor: '#f3e5f5' }]}
                  onPress={() => router.push({ pathname: '/qr-scanner', params: { lectureId } })}
                >
                  <Ionicons name="qr-code" size={18} color="#7b1fa2" />
                  <Text style={[styles.toolBtnText, { color: '#7b1fa2' }]}>مسح QR</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toolBtn, { backgroundColor: '#e3f2fd' }]}
                  onPress={handleExportPdf}
                  disabled={exportingPdf}
                  data-testid="export-pdf-btn"
                >
                  {exportingPdf ? (
                    <ActivityIndicator size="small" color="#1565c0" />
                  ) : (
                    <Ionicons name="document-text" size={18} color="#1565c0" />
                  )}
                  <Text style={[styles.toolBtnText, { color: '#1565c0' }]}>تصدير PDF</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Students list card */}
            <View style={styles.listCard}>
              <View style={styles.listCardHeader}>
                <Text style={styles.listCardTitle}>قائمة الحضور</Text>
                <Text style={styles.listCardCount}>
                  <Text style={styles.listCardCountAccent}>{students.length}</Text> طالب
                </Text>
              </View>

              {students.length === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons name="people-outline" size={56} color="#cfd6e1" />
                  <Text style={styles.emptyTitle}>لا يوجد طلاب مسجلين</Text>
                  <Text style={styles.emptySubtitle}>قم بإضافة طلاب من صفحة &quot;طلاب المقرر&quot;</Text>
                </View>
              ) : (
                <View style={{ opacity: (canTakeAttendanceNow || canEditAttendance) ? 1 : 0.5 }}>
                  <FlatList
                    data={students}
                    renderItem={renderStudent}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={{ padding: 10 }}
                    scrollEnabled={false}
                  />
                </View>
              )}
            </View>

            {/* Spacer for fixed save button */}
            <View style={{ height: 90 }} />

          </ScrollView>
        )}

        {/* Bottom action bar */}
        {!errorMessage && students.length > 0 && ((canRecordAttendance && canTakeAttendanceNow) || canEditAttendance) && (
          <View style={styles.bottomBar}>
            <TouchableOpacity
              style={[styles.saveButton, saving && styles.saveButtonDisabled]}
              onPress={promptForLessonAndSave}
              disabled={saving}
              data-testid="save-attendance-btn"
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={22} color="#fff" />
                  <Text style={styles.saveButtonText}>
                    {attendanceRecorded ? 'تحديث الحضور' : 'حفظ الحضور'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

        {!errorMessage && students.length > 0 && !canTakeAttendanceNow && !canEditAttendance && attendanceStatus && (
          <View style={styles.bottomBar}>
            <View style={[styles.noPermissionBanner, { backgroundColor:
              attendanceStatus.status === 'completed' ? '#e3f2fd' :
              attendanceStatus.status === 'not_started' ? '#fff3e0' : '#ffebee'
            }]}>
              <Ionicons
                name={attendanceStatus.status === 'completed' ? 'lock-closed' :
                      attendanceStatus.status === 'not_started' ? 'time-outline' : 'close-circle'}
                size={20}
                color={attendanceStatus.status === 'completed' ? '#1565c0' :
                       attendanceStatus.status === 'not_started' ? '#ef6c00' : '#c62828'}
              />
              <Text style={[styles.noPermissionText, {
                color: attendanceStatus.status === 'completed' ? '#1565c0' :
                       attendanceStatus.status === 'not_started' ? '#ef6c00' : '#c62828'
              }]}>
                {attendanceStatus.reason}
              </Text>
            </View>
          </View>
        )}

        {!errorMessage && students.length > 0 && !canRecordAttendance && !canEditAttendance && canTakeAttendanceNow && (
          <View style={styles.bottomBar}>
            <View style={styles.noPermissionBanner}>
              <Ionicons name="lock-closed" size={20} color="#ef6c00" />
              <Text style={[styles.noPermissionText, { color: '#ef6c00' }]}>عرض فقط - ليس لديك صلاحية تسجيل الحضور</Text>
            </View>
          </View>
        )}

        </KeyboardAvoidingView>

        {/* Modal اختيار موضوع الدرس */}
        <Modal visible={showLessonModal} transparent animationType="slide">
          <View style={modalStyles.overlay}>
            <View style={modalStyles.card}>
              <Text style={modalStyles.title}>تأكيد إنجاز الدرس</Text>
              <Text style={modalStyles.subtitle}>
                ما الموضوع الذي تم تدريسه في هذه المحاضرة؟ (اختياري لكن مهم لتحديث الخطة الدراسية)
              </Text>

              <Text style={modalStyles.label}>عنوان الدرس</Text>
              <TextInput
                style={modalStyles.input}
                value={lessonTitle}
                onChangeText={setLessonTitle}
                placeholder="مثال: الباب الأول - مقدمة"
                placeholderTextColor="#aaa"
                testID="lesson-title-input"
              />

              {studyPlan?.weeks && studyPlan.weeks.length > 0 && (
                <>
                  <Text style={modalStyles.label}>أو اختر من الخطة الدراسية:</Text>
                  <ScrollView style={modalStyles.topicsScroll}>
                    {studyPlan.weeks.map((week: any, wi: number) => (
                      <View key={wi} style={modalStyles.weekBlock}>
                        <Text style={modalStyles.weekTitle}>
                          الأسبوع {week.week_number}{week.completion_percent === 100 ? ' ✓' : ''}
                        </Text>
                        {week.topics?.map((topic: any, ti: number) => {
                          const isSelected = planTopicId === topic.id;
                          const isCompleted = topic.completed;
                          return (
                            <TouchableOpacity
                              key={ti}
                              style={[
                                modalStyles.topicRow,
                                isSelected && modalStyles.topicRowSelected,
                                isCompleted && modalStyles.topicRowCompleted,
                              ]}
                              onPress={() => {
                                setPlanTopicId(topic.id);
                                setLessonTitle(topic.title || '');
                              }}
                              disabled={isCompleted && !isSelected}
                              testID={`topic-option-${topic.id}`}
                            >
                              <Ionicons
                                name={isSelected ? 'radio-button-on' : isCompleted ? 'checkmark-circle' : 'radio-button-off'}
                                size={16}
                                color={isCompleted ? '#4caf50' : isSelected ? '#1565c0' : '#999'}
                              />
                              <Text style={[
                                modalStyles.topicText,
                                isCompleted && { color: '#4caf50', textDecorationLine: 'line-through' as any },
                              ]}>
                                {topic.title}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    ))}
                  </ScrollView>
                </>
              )}

              <View style={modalStyles.actions}>
                <TouchableOpacity
                  style={modalStyles.cancelBtn}
                  onPress={() => setShowLessonModal(false)}
                  disabled={savingLesson}
                >
                  <Text style={modalStyles.cancelBtnText}>إلغاء</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={modalStyles.skipBtn}
                  onPress={async () => {
                    setShowLessonModal(false);
                    setLessonTitle('');
                    setPlanTopicId(null);
                    await saveAttendance();
                  }}
                  disabled={savingLesson}
                >
                  <Text style={modalStyles.skipBtnText}>تخطّي</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={modalStyles.confirmBtn}
                  onPress={async () => {
                    setSavingLesson(true);
                    setShowLessonModal(false);
                    await saveAttendance();
                    setSavingLesson(false);
                  }}
                  disabled={savingLesson}
                  testID="confirm-lesson-save"
                >
                  <Text style={modalStyles.confirmBtnText}>{savingLesson ? 'جاري الحفظ...' : 'تأكيد وحفظ'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </>
  );
}

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 18,
    width: '100%',
    maxWidth: 480,
    maxHeight: '85%',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1565c0',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    marginBottom: 12,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
    marginTop: 6,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    textAlign: 'right',
  },
  topicsScroll: {
    maxHeight: 240,
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 8,
    padding: 6,
  },
  weekBlock: {
    marginBottom: 8,
  },
  weekTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1565c0',
    marginBottom: 4,
  },
  topicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderRadius: 6,
  },
  topicRowSelected: {
    backgroundColor: '#e3f2fd',
  },
  topicRowCompleted: {
    opacity: 0.7,
  },
  topicText: {
    fontSize: 12,
    color: '#333',
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 14,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#999',
    alignItems: 'center',
  },
  cancelBtnText: {
    color: '#666',
    fontSize: 12,
    fontWeight: '600',
  },
  skipBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
  },
  skipBtnText: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
  },
  confirmBtn: {
    flex: 1.4,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#1565c0',
    alignItems: 'center',
  },
  confirmBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
});


const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f6fb' },
  pageScroll: { padding: 20, paddingBottom: 40, maxWidth: 1200, width: '100%', alignSelf: 'center' },

  // page header
  pageHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 12 },
  pageHeaderRight: { alignItems: 'flex-end', flex: 1, minWidth: 280 },
  pageTitle: { fontSize: 26, fontWeight: '700', color: '#1a2540', textAlign: 'right', marginBottom: 6 },
  breadcrumb: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  breadcrumbLink: { fontSize: 13, color: '#2962ff', fontWeight: '500' },
  breadcrumbCurrent: { fontSize: 13, color: '#8a95a8', fontWeight: '500', maxWidth: 240 },
  pageHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 8 },
  btnGhost: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e3e7ee' },
  btnGhostText: { color: '#1a2540', fontSize: 13, fontWeight: '600' },

  // course info card
  courseCard: { backgroundColor: '#fff', borderRadius: 14, padding: 18, marginBottom: 14, flexDirection: 'row-reverse', alignItems: 'center', gap: 14, borderWidth: 1, borderColor: '#eef1f6' },
  courseIconWrap: { width: 56, height: 56, borderRadius: 12, backgroundColor: '#1565c0', alignItems: 'center', justifyContent: 'center' },
  courseTitle: { fontSize: 17, fontWeight: '700', color: '#1a2540', textAlign: 'right' },
  lectureMetaRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  lectureMetaChip: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: '#f4f6fb' },
  lectureMetaText: { fontSize: 11, color: '#5b6678', fontWeight: '600' },
  statusPill: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, marginTop: 8 },
  statusPillText: { fontSize: 11, fontWeight: '700' },

  // status bar
  statusBar: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 12, borderRadius: 12, marginBottom: 14, flexWrap: 'wrap' },
  statusBarText: { fontSize: 13, fontWeight: '700' },
  statusBarDeadline: { fontSize: 11, color: '#5b6678' },

  // stats grid
  statsGrid: { flexDirection: 'row', gap: 14, marginBottom: 18, flexWrap: 'wrap' },
  statCard: { flex: 1, minWidth: 180, backgroundColor: '#fff', borderRadius: 14, padding: 16, flexDirection: 'row-reverse', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: '#eef1f6' },
  statIconWrap: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  statTextCol: { flex: 1, alignItems: 'flex-end' },
  statLabel: { fontSize: 12, color: '#8a95a8', fontWeight: '500', marginBottom: 2 },
  statValue: { fontSize: 22, color: '#1a2540', fontWeight: '700', marginBottom: 1 },
  statSubLabel: { fontSize: 10, color: '#a8b1c2' },

  // toolbar
  toolbarCard: { flexDirection: 'row', gap: 10, marginBottom: 14, flexWrap: 'wrap' },
  toolBtn: { flex: 1, minWidth: 140, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 10 },
  toolBtnText: { fontSize: 13, fontWeight: '700' },

  // list card
  listCard: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#eef1f6' },
  listCardHeader: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderBottomWidth: 1, borderBottomColor: '#eef1f6' },
  listCardTitle: { fontSize: 15, fontWeight: '700', color: '#1a2540' },
  listCardCount: { fontSize: 12, color: '#5b6678' },
  listCardCountAccent: { color: '#1565c0', fontWeight: '700' },

  // student card
  studentCard: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 6, flexDirection: 'row-reverse', alignItems: 'center', borderWidth: 1, borderColor: '#eef1f6' },
  studentIndex: { width: 36, height: 36, borderRadius: 18, fontSize: 13, fontWeight: '700', color: '#5b6678', textAlign: 'center', lineHeight: 36, backgroundColor: '#f4f6fb' },
  studentInfo: { flex: 1, marginHorizontal: 12, alignItems: 'flex-end' },
  studentName: { fontSize: 14, fontWeight: '600', color: '#1a2540', textAlign: 'right' },
  studentId: { fontSize: 12, color: '#8a95a8', marginTop: 2, textAlign: 'right' },
  statusBadge: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, minWidth: 70, alignItems: 'center' },
  pendingBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, backgroundColor: '#fff3cd', borderWidth: 1, borderColor: '#ffe58f', marginHorizontal: 6 },
  pendingText: { fontSize: 10, color: '#8a6d3b', fontWeight: '600' },
  approvalBanner: { backgroundColor: '#fff3cd', borderRightWidth: 4, borderRightColor: '#ffb300', padding: 10, marginHorizontal: 12, marginTop: 8, borderRadius: 6 },
  approvalBannerText: { fontSize: 12, color: '#8a6d3b', textAlign: 'right', fontWeight: '600' },
  statusText: { fontSize: 13, fontWeight: '700' },

  // empty state
  emptyState: { alignItems: 'center', paddingVertical: 50, gap: 6 },
  emptyTitle: { fontSize: 15, color: '#5b6678', marginTop: 12, fontWeight: '600' },
  emptySubtitle: { fontSize: 12, color: '#8a95a8', textAlign: 'center' },

  // bottom bar
  bottomBar: { padding: 14, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#eef1f6' },
  saveButton: { backgroundColor: '#2e7d32', borderRadius: 12, paddingVertical: 14, flexDirection: 'row-reverse', justifyContent: 'center', alignItems: 'center', gap: 8 },
  saveButtonDisabled: { opacity: 0.7 },
  saveButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  noPermissionBanner: { backgroundColor: '#fff3e0', borderRadius: 10, padding: 14, flexDirection: 'row-reverse', justifyContent: 'center', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#ffcc80' },
  noPermissionText: { color: '#ef6c00', fontSize: 13, fontWeight: '600', flex: 1, textAlign: 'right' },

  // error card
  errorCard: { backgroundColor: '#fff', borderRadius: 14, padding: 28, borderWidth: 1, borderColor: '#eef1f6', alignItems: 'center', maxWidth: 480, alignSelf: 'center', width: '100%' },
  errorIconWrap: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#ffebee', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  errorTitle: { fontSize: 18, fontWeight: '700', color: '#c62828', textAlign: 'center', marginBottom: 8 },
  errorText: { fontSize: 14, color: '#5b6678', textAlign: 'center' },
  errorPrimaryBtn: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, backgroundColor: '#1565c0', paddingHorizontal: 18, paddingVertical: 11, borderRadius: 10 },
  errorPrimaryBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  errorGhostBtn: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e3e7ee', paddingHorizontal: 18, paddingVertical: 11, borderRadius: 10 },
  errorGhostBtnText: { color: '#1565c0', fontSize: 14, fontWeight: '700' },
});
