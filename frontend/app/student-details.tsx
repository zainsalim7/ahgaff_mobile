import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  TextInput,
  Modal,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Picker } from '@react-native-picker/picker';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import api, {
  studentsAPI,
  departmentsAPI,
  attendanceAPI,
  reportsAPI,
  notificationsAPI,
} from '../src/services/api';
import { LoadingScreen } from '../src/components/LoadingScreen';
import { useAuth, PERMISSIONS } from '../src/contexts/AuthContext';
import { formatGregorianDate } from '../src/utils/dateUtils';

// ============== الأنواع ==============
interface StudentCourse {
  id: string;
  name: string;
  code: string;
  level: number;
  section: string;
  credit_hours: number;
  teacher_id?: string;
  teacher_name?: string;
  semester_id?: string;
  semester_name?: string;
}

interface CoursesResponse {
  student_id: string;
  total_courses: number;
  is_inferred: boolean;
  courses: StudentCourse[];
}

interface AttendanceStats {
  total_sessions: number;
  present_count: number;
  absent_count: number;
  late_count: number;
  excused_count: number;
  attendance_rate: number;
}

interface AttendanceRecord {
  id: string;
  course_id: string;
  course_name: string;
  status: string;
  date: string;
  start_time?: string;
  end_time?: string;
  method: string;
}

// حالات الطالب (graduated مستثنى - يُعيَّن تلقائياً عند التخريج عبر زر تخريج)
const STATUS_OPTIONS = [
  { value: 'active', label: 'مستمر', color: '#2e7d32', bg: '#e8f5e9', icon: 'checkmark-circle' as const },
  { value: 'repeat', label: 'إعادة', color: '#ef6c00', bg: '#fff3e0', icon: 'refresh-circle' as const },
  { value: 'expelled', label: 'مفصول', color: '#c62828', bg: '#ffebee', icon: 'close-circle' as const },
  { value: 'frozen', label: 'مجمَّد', color: '#5e35b1', bg: '#ede7f6', icon: 'snow' as const },
];
// خريطة كاملة للحالات (للعرض فقط - graduated يظهر هنا للطلاب المتخرجين سابقاً)
const ALL_STATUS_INFO: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  active: { label: 'مستمر', color: '#2e7d32', bg: '#e8f5e9', icon: 'checkmark-circle' },
  repeat: { label: 'إعادة', color: '#ef6c00', bg: '#fff3e0', icon: 'refresh-circle' },
  graduated: { label: 'متخرج', color: '#1565c0', bg: '#e3f2fd', icon: 'school' },
  expelled: { label: 'مفصول', color: '#c62828', bg: '#ffebee', icon: 'close-circle' },
  frozen: { label: 'مجمَّد', color: '#5e35b1', bg: '#ede7f6', icon: 'snow' },
  inactive: { label: 'غير نشط', color: '#666', bg: '#f5f5f5', icon: 'help-circle' },
};
const getStatusInfo = (s: string) =>
  ALL_STATUS_INFO[s] || ALL_STATUS_INFO.active;

const LEVELS = ['1', '2', '3', '4', '5'];

const showMessage = (title: string, message: string) => {
  if (Platform.OS === 'web') window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
};
const showConfirm = (title: string, message: string, onYes: () => void) => {
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n\n${message}`)) onYes();
  } else {
    Alert.alert(title, message, [
      { text: 'إلغاء', style: 'cancel' },
      { text: 'تأكيد', onPress: onYes },
    ]);
  }
};

export default function StudentDetailsScreen() {
  const { studentId } = useLocalSearchParams<{ studentId?: string }>();
  const router = useRouter();
  const { hasPermission, user } = useAuth();

  const canManage =
    user?.role === 'admin' || (user && hasPermission(PERMISSIONS.MANAGE_STUDENTS));

  // State
  const [student, setStudent] = useState<any>(null);
  const [departmentName, setDepartmentName] = useState<string>('');
  const [courses, setCourses] = useState<StudentCourse[]>([]);
  const [coursesInferred, setCoursesInferred] = useState(false);
  const [loading, setLoading] = useState(true);

  // Attendance — يُحمَّل الملخص تلقائياً، أما التفاصيل (السجلات) فيدوياً
  const [attendanceStats, setAttendanceStats] = useState<AttendanceStats | null>(null);
  const [attendanceByCourse, setAttendanceByCourse] = useState<Record<string, AttendanceStats>>({});
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [showRecords, setShowRecords] = useState(false);

  // توسيع سجل الحضور لمقرر معيّن
  const [expandedCourseId, setExpandedCourseId] = useState<string | null>(null);
  const [courseRecordsCache, setCourseRecordsCache] = useState<Record<string, AttendanceRecord[]>>({});
  const [loadingCourseId, setLoadingCourseId] = useState<string | null>(null);

  // مودال تغيير المستوى
  const [showLevelModal, setShowLevelModal] = useState(false);
  const [newLevel, setNewLevel] = useState('1');
  const [savingLevel, setSavingLevel] = useState(false);

  // Edit Modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState({
    full_name: '',
    phone: '',
    email: '',
    level: '1',
    section: '',
  });
  const [savingEdit, setSavingEdit] = useState(false);

  // Status Modal
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [newStatus, setNewStatus] = useState<string>('active');
  const [statusReason, setStatusReason] = useState('');
  const [statusNewLevel, setStatusNewLevel] = useState('');
  const [savingStatus, setSavingStatus] = useState(false);

  // 🆕 Graduate Modal
  const [showGraduateModal, setShowGraduateModal] = useState(false);
  const [gradYear, setGradYear] = useState<string>(String(new Date().getFullYear()));
  const [gradDate, setGradDate] = useState<string>('');
  const [gradSemester, setGradSemester] = useState<string>('second');
  const [gradGpa, setGradGpa] = useState<string>('');
  const [gradHours, setGradHours] = useState<string>('');
  const [gradCertNum, setGradCertNum] = useState<string>('');
  const [gradHonors, setGradHonors] = useState<string>('');
  const [gradNotes, setGradNotes] = useState<string>('');
  const [savingGraduate, setSavingGraduate] = useState(false);

  // 🔄 Transfer Modal — نقل الطالب لكلية/قسم/مستوى/شعبة جديدة
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferFaculties, setTransferFaculties] = useState<any[]>([]);
  const [transferDepts, setTransferDepts] = useState<any[]>([]);
  const [trgFacId, setTrgFacId] = useState<string>('');
  const [trgDeptId, setTrgDeptId] = useState<string>('');
  const [trgLevel, setTrgLevel] = useState<string>('1');
  const [trgSection, setTrgSection] = useState<string>('');
  const [trgReason, setTrgReason] = useState<string>('');
  const [savingTransfer, setSavingTransfer] = useState(false);
  const [transferHistory, setTransferHistory] = useState<any[]>([]);

  // Export Excel + PDF
  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [statementModal, setStatementModal] = useState(false);
  const [statementNationality, setStatementNationality] = useState('');
  const [statementPurpose, setStatementPurpose] = useState('');
  const [statementValidDays, setStatementValidDays] = useState('');
  const [statementSignatoryName, setStatementSignatoryName] = useState('');
  const [statementSignatoryTitle, setStatementSignatoryTitle] = useState('');
  const [issuingStatement, setIssuingStatement] = useState(false);
  const [lastStatement, setLastStatement] = useState<any>(null);

  // 🆕 Notifications (إشعارات/إنذارات الطالب)
  const [studentNotifications, setStudentNotifications] = useState<any[]>([]);
  const [notifsLoading, setNotifsLoading] = useState(false);
  const [showNotifModal, setShowNotifModal] = useState(false);
  const [notifForm, setNotifForm] = useState({ title: '', message: '', type: 'warning' });
  const [sendingNotif, setSendingNotif] = useState(false);
  const [notifsExpanded, setNotifsExpanded] = useState(false); // 🆕 مطوي افتراضياً

  // ============== Fetch ==============
  const fetchStudent = useCallback(async () => {
    if (!studentId) {
      setLoading(false);
      return;
    }
    try {
      const [studentRes, coursesRes, deptsRes] = await Promise.all([
        studentsAPI.getById(String(studentId)),
        studentsAPI.getCourses(String(studentId)).catch(() => ({
          data: { courses: [], total_courses: 0, is_inferred: false },
        })),
        departmentsAPI.getAll().catch(() => ({ data: [] })),
      ]);
      const sData = studentRes.data;
      setStudent(sData);
      const cData = coursesRes.data as CoursesResponse;
      const courseList = cData.courses || [];
      setCourses(courseList);
      setCoursesInferred(!!cData.is_inferred);

      const dept = (deptsRes.data || []).find(
        (d: any) => d.id === sData.department_id,
      );
      setDepartmentName(dept?.name || 'غير محدد');

      // تحميل ملخص الحضور تلقائياً (إجمالي + لكل مقرر)
      const sid = String(studentId);
      attendanceAPI.getStudentStats(sid)
        .then(r => setAttendanceStats(r.data))
        .catch(() => {});
      if (courseList.length > 0) {
        const statsResults = await Promise.all(
          courseList.map(c =>
            attendanceAPI.getStudentStats(sid, c.id)
              .then(r => [c.id, r.data] as [string, AttendanceStats])
              .catch(() => null),
          ),
        );
        const map: Record<string, AttendanceStats> = {};
        statsResults.forEach(item => { if (item) map[item[0]] = item[1]; });
        setAttendanceByCourse(map);
      }
    } catch (e: any) {
      console.error('Error loading student:', e);
      showMessage('خطأ', e?.response?.data?.detail || 'فشل تحميل بيانات الطالب');
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    fetchStudent();
  }, [fetchStudent]);

  // 🆕 جلب الإشعارات المرسلة للطالب
  const fetchStudentNotifications = useCallback(async () => {
    if (!studentId) return;
    setNotifsLoading(true);
    try {
      const res = await notificationsAPI.getStudentNotifications(String(studentId));
      setStudentNotifications(res.data?.notifications || []);
    } catch (e: any) {
      // 403 صامت - بعض الأدوار قد لا يكون لها صلاحية القراءة
      setStudentNotifications([]);
    } finally {
      setNotifsLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    fetchStudentNotifications();
  }, [fetchStudentNotifications]);

  // 🆕 حذف إشعار محدد (لمن لديه صلاحية SEND_NOTIFICATIONS)
  const canSendNotifications =
    user?.role === 'admin' || (user && hasPermission(PERMISSIONS.SEND_NOTIFICATIONS));

  const handleDeleteNotification = (notif: any) => {
    if (!student) return;
    showConfirm('حذف الإشعار', `هل أنت متأكد من حذف إشعار "${notif.title}"؟`, async () => {
      try {
        await notificationsAPI.deleteForStudent(student.id, notif.id);
        setStudentNotifications((prev) => prev.filter((n) => n.id !== notif.id));
      } catch (e: any) {
        showMessage('خطأ', e?.response?.data?.detail || 'فشل حذف الإشعار');
      }
    });
  };

  // 🆕 فتح مودال إرسال إشعار جديد
  const openNotifModal = () => {
    if (!student) return;
    setNotifForm({
      title: `⚠️ إنذار للطالب ${student.full_name}`,
      message: '',
      type: 'warning',
    });
    setShowNotifModal(true);
  };

  // 🆕 إرسال الإشعار
  const handleSendNotification = async () => {
    if (!student) return;
    if (!notifForm.message.trim()) {
      showMessage('خطأ', 'يرجى كتابة نص الإشعار');
      return;
    }
    if (!notifForm.title.trim()) {
      showMessage('خطأ', 'يرجى كتابة عنوان الإشعار');
      return;
    }
    setSendingNotif(true);
    try {
      await notificationsAPI.sendManual({
        student_id: student.id,
        title: notifForm.title.trim(),
        message: notifForm.message.trim(),
        type: notifForm.type,
      });
      showMessage('تم', `تم إرسال الإشعار للطالب ${student.full_name}`);
      setShowNotifModal(false);
      setNotifForm({ title: '', message: '', type: 'warning' });
      // تحديث قائمة الإشعارات
      fetchStudentNotifications();
    } catch (e: any) {
      showMessage('خطأ', e?.response?.data?.detail || 'فشل في إرسال الإشعار');
    } finally {
      setSendingNotif(false);
    }
  };

  // ============== Actions ==============
  const handleLoadAttendanceRecords = async () => {
    if (!student) return;
    setRecordsLoading(true);
    try {
      const res = await attendanceAPI.getStudentAttendance(student.id);
      setAttendanceRecords(res.data || []);
      setShowRecords(true);
    } catch (e: any) {
      showMessage('خطأ', e?.response?.data?.detail || 'فشل تحميل سجل الحضور');
    } finally {
      setRecordsLoading(false);
    }
  };

  // فتح/طيّ سجل الحضور لمقرر معيّن داخل بطاقة المقرر
  const toggleCourseAttendance = async (courseId: string) => {
    if (!student) return;
    if (expandedCourseId === courseId) {
      setExpandedCourseId(null);
      return;
    }
    setExpandedCourseId(courseId);
    if (courseRecordsCache[courseId]) return; // محمَّل مسبقاً
    setLoadingCourseId(courseId);
    try {
      const res = await attendanceAPI.getStudentAttendance(student.id, courseId);
      setCourseRecordsCache(p => ({ ...p, [courseId]: res.data || [] }));
    } catch (e: any) {
      setCourseRecordsCache(p => ({ ...p, [courseId]: [] }));
      showMessage('خطأ', e?.response?.data?.detail || 'فشل تحميل سجل الحضور');
    } finally {
      setLoadingCourseId(null);
    }
  };

  // فتح مودال تغيير المستوى
  const openLevelModal = () => {
    if (!student) return;
    setNewLevel(String(student.level || '1'));
    setShowLevelModal(true);
  };

  const handleSaveLevel = async () => {
    if (!student) return;
    if (parseInt(newLevel) === student.level) {
      setShowLevelModal(false);
      return;
    }
    setSavingLevel(true);
    try {
      await studentsAPI.update(student.id, { level: parseInt(newLevel) } as any);
      showMessage('تم', `تم تغيير المستوى إلى م${newLevel}`);
      setShowLevelModal(false);
      fetchStudent();
    } catch (e: any) {
      showMessage('خطأ', e?.response?.data?.detail || 'فشل تحديث المستوى');
    } finally {
      setSavingLevel(false);
    }
  };

  const openEditModal = () => {
    if (!student) return;
    setEditForm({
      full_name: student.full_name || '',
      phone: student.phone || '',
      email: student.email || '',
      level: String(student.level || '1'),
      section: student.section || '',
    });
    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
    if (!student) return;
    if (!editForm.full_name.trim()) {
      showMessage('خطأ', 'يرجى إدخال اسم الطالب');
      return;
    }
    setSavingEdit(true);
    try {
      await studentsAPI.update(student.id, {
        full_name: editForm.full_name.trim(),
        phone: editForm.phone.trim(),
        email: editForm.email.trim(),
        level: parseInt(editForm.level) || 1,
        section: editForm.section.trim(),
      } as any);
      showMessage('تم', 'تم تحديث بيانات الطالب');
      setShowEditModal(false);
      fetchStudent();
    } catch (e: any) {
      showMessage('خطأ', e?.response?.data?.detail || 'فشل التحديث');
    } finally {
      setSavingEdit(false);
    }
  };

  const openStatusModal = () => {
    if (!student) return;
    setNewStatus(student.status || 'active');
    setStatusReason('');
    setStatusNewLevel('');
    setShowStatusModal(true);
  };

  const handleChangeStatus = async () => {
    if (!student) return;
    setSavingStatus(true);
    try {
      const body: any = {
        new_status: newStatus,
        reason: statusReason || '',
      };
      if (statusNewLevel) body.new_level = parseInt(statusNewLevel);
      await api.post(`/student-status/${student.id}/change`, body);
      showMessage('تم', `تم تغيير الحالة إلى "${getStatusInfo(newStatus).label}"`);
      setShowStatusModal(false);
      fetchStudent();
    } catch (e: any) {
      showMessage('خطأ', e?.response?.data?.detail || 'فشل تغيير الحالة');
    } finally {
      setSavingStatus(false);
    }
  };

  // 🆕 تخريج الطالب
  const handleGraduate = async () => {
    if (!student) return;
    const yearNum = parseInt(gradYear);
    if (isNaN(yearNum) || yearNum < 2000 || yearNum > 2100) {
      showMessage('خطأ', 'سنة التخرج مطلوبة وتكون بين 2000 و 2100');
      return;
    }
    setSavingGraduate(true);
    try {
      const body: any = { graduation_year: yearNum };
      if (gradDate) body.graduation_date = gradDate;
      if (gradSemester) body.graduation_semester = gradSemester;
      if (gradGpa) body.final_gpa = parseFloat(gradGpa);
      if (gradHours) body.total_credit_hours = parseInt(gradHours);
      if (gradCertNum) body.certificate_number = gradCertNum;
      if (gradHonors) body.honors = gradHonors;
      if (gradNotes) body.notes = gradNotes;
      await studentsAPI.graduate(student.id, body);
      showMessage('تم', `تم تخريج "${student.full_name}" بنجاح وانتقل إلى قائمة الخريجين`);
      setShowGraduateModal(false);
      // إعادة تحميل أو الانتقال إلى صفحة الخريجين
      setTimeout(() => router.replace('/alumni' as any), 800);
    } catch (e: any) {
      showMessage('خطأ', e?.response?.data?.detail || 'فشل التخريج');
    } finally {
      setSavingGraduate(false);
    }
  };

  // 🔄 نقل الطالب — فتح المودال وتحميل الكليات
  const openTransferModal = async () => {
    if (!student) return;
    setTrgFacId(student.faculty_id || '');
    setTrgDeptId(student.department_id || '');
    setTrgLevel(String(student.level || 1));
    setTrgSection(student.section || '');
    setTrgReason('');
    try {
      const [facsRes, deptsRes, histRes] = await Promise.all([
        api.get('/faculties'),
        api.get('/departments'),
        api.get(`/students/${student.id}/transfer-history`).catch(() => ({ data: { items: [] } })),
      ]);
      setTransferFaculties(facsRes.data || []);
      setTransferDepts(deptsRes.data || []);
      setTransferHistory(histRes.data?.items || []);
    } catch (e: any) {
      showMessage('خطأ', e?.response?.data?.detail || 'فشل تحميل بيانات النقل');
      return;
    }
    setShowTransferModal(true);
  };

  // 🔄 تنفيذ النقل
  const handleTransfer = async () => {
    if (!student) return;
    if (!trgDeptId) { showMessage('خطأ', 'اختر القسم الهدف'); return; }
    const lvl = parseInt(trgLevel);
    if (isNaN(lvl) || lvl < 1 || lvl > 10) { showMessage('خطأ', 'المستوى غير صالح (1-10)'); return; }
    setSavingTransfer(true);
    try {
      await api.post(`/students/${student.id}/transfer`, {
        target_faculty_id: trgFacId || undefined,
        target_department_id: trgDeptId,
        target_level: lvl,
        target_section: trgSection.trim(),
        reason: trgReason.trim() || undefined,
      });
      showMessage('تم النقل ✅', `تم نقل "${student.full_name}" بنجاح`);
      setShowTransferModal(false);
      fetchStudent();
    } catch (e: any) {
      showMessage('خطأ', e?.response?.data?.detail || 'فشل النقل');
    } finally {
      setSavingTransfer(false);
    }
  };

  const handleActivateAccount = () => {
    if (!student) return;
    showConfirm('تفعيل حساب الطالب', `هل تريد تفعيل حساب ${student.full_name}؟`, async () => {
      try {
        const res = await studentsAPI.activateAccount(student.id);
        showMessage(
          'تم التفعيل ✅',
          `اسم المستخدم: ${res.data.username}\nكلمة المرور: ${student.student_id}`,
        );
        fetchStudent();
      } catch (e: any) {
        showMessage('خطأ', e?.response?.data?.detail || 'فشل التفعيل');
      }
    });
  };

  const handleDeactivateAccount = () => {
    if (!student) return;
    showConfirm(
      'إلغاء تفعيل الحساب',
      `هل تريد إلغاء تفعيل حساب ${student.full_name}؟`,
      async () => {
        try {
          await studentsAPI.deactivateAccount(student.id);
          showMessage('تم', 'تم إلغاء تفعيل الحساب');
          fetchStudent();
        } catch (e: any) {
          showMessage('خطأ', e?.response?.data?.detail || 'فشل العملية');
        }
      },
    );
  };

  const handleResetPassword = () => {
    if (!student) return;
    showConfirm(
      'إعادة تعيين كلمة المرور',
      `سيتم إعادة تعيين كلمة المرور لـ ${student.full_name} إلى رقم القيد.`,
      async () => {
        try {
          await studentsAPI.resetPassword(student.id);
          showMessage('تم', `كلمة المرور الجديدة: ${student.student_id}`);
        } catch (e: any) {
          showMessage('خطأ', e?.response?.data?.detail || 'فشل إعادة التعيين');
        }
      },
    );
  };

  // Helper مشترك لتنزيل ملف Blob على الويب
  const downloadBlob = (data: any, filename: string, mime: string) => {
    const blob = new Blob([data], { type: mime });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try { document.body.removeChild(a); } catch {}
      window.URL.revokeObjectURL(url);
    }, 100);
  };

  const handleExportExcel = async () => {
    if (!student) return;
    setExportingExcel(true);
    try {
      const res = await reportsAPI.exportStudentReportExcel(student.id);
      downloadBlob(
        res.data,
        `student_${student.student_id}_report.xlsx`,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
    } catch (e: any) {
      showMessage('خطأ', e?.response?.data?.detail || 'فشل تصدير التقرير');
    } finally {
      setExportingExcel(false);
    }
  };

  const handleExportPdf = async () => {
    if (!student) return;
    setExportingPdf(true);
    try {
      const res = await reportsAPI.exportStudentReportPDF(student.id);
      downloadBlob(res.data, `student_${student.student_id}_report.pdf`, 'application/pdf');
    } catch (e: any) {
      showMessage('خطأ', e?.response?.data?.detail || 'فشل تصدير PDF');
    } finally {
      setExportingPdf(false);
    }
  };

  const handleIssueStatement = async () => {
    if (!student) return;
    setIssuingStatement(true);
    try {
      const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
      const res = await api.post('/statements/issue', {
        student_id: student.id,
        nationality: statementNationality || undefined,
        purpose: statementPurpose || undefined,
        base_url: baseUrl,
        valid_days: statementValidDays && parseInt(statementValidDays, 10) > 0 ? parseInt(statementValidDays, 10) : undefined,
        signatory_name: statementSignatoryName.trim() || undefined,
        signatory_title: statementSignatoryTitle.trim() || undefined,
      });
      setLastStatement(res.data);
      const pdfRes = await api.get(`/statements/${res.data.id}/pdf`, { responseType: 'blob' });
      downloadBlob(pdfRes.data, `statement_${res.data.number.replace('/', '-')}.pdf`, 'application/pdf');
    } catch (e: any) {
      showMessage('خطأ', e?.response?.data?.detail || 'فشل إصدار الإفادة');
    } finally {
      setIssuingStatement(false);
    }
  };

  // ============== Computed ==============
  const totalCreditHours = useMemo(
    () => courses.reduce((sum, c) => sum + (c.credit_hours || 0), 0),
    [courses],
  );

  const statusInfo = getStatusInfo(student?.status || (student?.is_active === false ? 'frozen' : 'active'));
  const isAccountActive = !!student?.user_id;

  // ============== Render ==============
  if (loading) return <LoadingScreen />;

  if (!student) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.notFoundWrap}>
          <Ionicons name="alert-circle-outline" size={64} color="#cfd6e1" />
          <Text style={styles.notFoundText}>الطالب غير موجود أو تم حذفه</Text>
          <TouchableOpacity
            style={[styles.headerBtn, styles.btnPrimary, { marginTop: 14 }]}
            onPress={() => router.replace('/students')}
          >
            <Ionicons name="arrow-back" size={16} color="#fff" />
            <Text style={styles.btnPrimaryText}>العودة للطلاب</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: student.full_name,
          headerBackTitle: 'رجوع',
        }}
      />
      <ScrollView
        dataSet={{ responsiveScrollRoot: 'true' }}
        style={{ flex: 1 }}
        contentContainerStyle={styles.pageScroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ============ رأس الصفحة ============ */}
        <View dataSet={{ responsive: 'page-header' }} style={styles.pageHeader}>
          <View style={styles.pageHeaderRight}>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <Text dataSet={{ responsive: 'page-title' }} style={styles.pageTitle}>
                تفاصيل الطالب
              </Text>
              <View style={[styles.statusBadge, { backgroundColor: statusInfo.bg }]}>
                <Ionicons name={statusInfo.icon} size={12} color={statusInfo.color} />
                <Text style={[styles.statusBadgeText, { color: statusInfo.color }]}>
                  {statusInfo.label}
                </Text>
              </View>
              {attendanceStats && (
                <View
                  style={[
                    styles.attendanceRatePill,
                    {
                      backgroundColor:
                        attendanceStats.attendance_rate >= 75 ? '#e8f5e9'
                        : attendanceStats.attendance_rate >= 50 ? '#fff3e0'
                        : '#ffebee',
                      borderColor:
                        attendanceStats.attendance_rate >= 75 ? '#81c784'
                        : attendanceStats.attendance_rate >= 50 ? '#ffb74d'
                        : '#e57373',
                    },
                  ]}
                  testID="overall-attendance-badge"
                >
                  <Ionicons
                    name="pie-chart"
                    size={12}
                    color={
                      attendanceStats.attendance_rate >= 75 ? '#2e7d32'
                      : attendanceStats.attendance_rate >= 50 ? '#e65100'
                      : '#c62828'
                    }
                  />
                  <Text style={[styles.attendanceRateText, {
                    color: attendanceStats.attendance_rate >= 75 ? '#2e7d32'
                      : attendanceStats.attendance_rate >= 50 ? '#e65100'
                      : '#c62828',
                  }]}>
                    نسبة الحضور: {attendanceStats.attendance_rate}%
                  </Text>
                </View>
              )}
            </View>
            <View style={styles.breadcrumb}>
              <TouchableOpacity onPress={() => router.replace('/')}>
                <Text style={styles.breadcrumbLink}>الرئيسية</Text>
              </TouchableOpacity>
              <Ionicons name="chevron-back" size={12} color="#8a95a8" />
              <TouchableOpacity onPress={() => router.replace('/students')}>
                <Text style={styles.breadcrumbLink}>الطلاب</Text>
              </TouchableOpacity>
              <Ionicons name="chevron-back" size={12} color="#8a95a8" />
              <Text style={styles.breadcrumbCurrent}>التفاصيل</Text>
            </View>
          </View>
          <View dataSet={{ responsive: 'page-header-actions' }} style={styles.pageHeaderActions}>
            <TouchableOpacity
              style={[styles.headerBtn, styles.btnGhost]}
              onPress={() => router.back()}
              testID="back-btn"
            >
              <Ionicons name="arrow-forward" size={16} color="#1a2540" />
              <Text style={styles.btnGhostText}>رجوع</Text>
            </TouchableOpacity>
            {canManage && (
              <TouchableOpacity
                style={[styles.headerBtn, { backgroundColor: '#00796b' }]}
                onPress={() => {
                  setStatementNationality((student as any)?.nationality || '');
                  setStatementPurpose('');
                  setLastStatement(null);
                  setStatementModal(true);
                }}
                testID="issue-statement-btn"
              >
                <Ionicons name="ribbon" size={16} color="#fff" />
                <Text style={styles.btnPrimaryText}>إفادة</Text>
              </TouchableOpacity>
            )}
            {canManage && (
              <TouchableOpacity
                style={[styles.headerBtn, { backgroundColor: '#00695c' }]}
                onPress={() => router.push(`/student-card?studentId=${student?.id}`)}
                testID="student-card-btn"
              >
                <Ionicons name="card" size={16} color="#fff" />
                <Text style={styles.btnPrimaryText}>البطاقة</Text>
              </TouchableOpacity>
            )}
            {canManage && (
              <TouchableOpacity
                style={[styles.headerBtn, styles.btnExport, exportingPdf && { opacity: 0.5 }]}
                onPress={handleExportPdf}
                disabled={exportingPdf}
                testID="export-pdf-btn"
              >
                {exportingPdf ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="document-text" size={16} color="#fff" />
                )}
                <Text style={styles.btnPrimaryText}>
                  {exportingPdf ? '...' : 'PDF'}
                </Text>
              </TouchableOpacity>
            )}
            {canManage && (
              <TouchableOpacity
                style={[styles.headerBtn, styles.btnExportExcel, exportingExcel && { opacity: 0.5 }]}
                onPress={handleExportExcel}
                disabled={exportingExcel}
                testID="export-excel-btn"
              >
                {exportingExcel ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="grid" size={16} color="#fff" />
                )}
                <Text style={styles.btnPrimaryText}>
                  {exportingExcel ? '...' : 'Excel'}
                </Text>
              </TouchableOpacity>
            )}
            {canManage && (
              <TouchableOpacity
                style={[styles.headerBtn, styles.btnPrimary]}
                onPress={openEditModal}
                testID="edit-student-btn"
              >
                <Ionicons name="create" size={16} color="#fff" />
                <Text style={styles.btnPrimaryText}>تعديل</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* ============ بطاقة الطالب ============ */}
        <View style={styles.studentCard}>
          <View style={styles.studentAvatar}>
            <Text style={styles.studentAvatarText}>
              {student.full_name?.charAt(0) || '?'}
            </Text>
          </View>
          <View style={{ flex: 1, alignItems: 'flex-end' }}>
            <Text style={styles.studentName}>{student.full_name}</Text>
            <View style={styles.studentSubRow}>
              <Text style={styles.studentSub}>رقم القيد:</Text>
              <Text style={styles.studentSubBold}>{student.student_id}</Text>
              {student.reference_number ? (
                <>
                  <View style={styles.dot} />
                  <Text style={styles.studentSub}>الرقم المرجعي:</Text>
                  <Text style={[styles.studentSubBold, { color: '#2e7d32' }]}>
                    {student.reference_number}
                  </Text>
                </>
              ) : null}
            </View>
            <View style={styles.studentSubRow}>
              <View style={styles.metaItem}>
                <Ionicons name="business-outline" size={13} color="#5b6678" />
                <Text style={styles.metaText}>{departmentName}</Text>
              </View>
              <View style={styles.dot} />
              <View style={styles.metaItem}>
                <Ionicons name="layers-outline" size={13} color="#5b6678" />
                <Text style={styles.metaText}>المستوى {student.level}</Text>
              </View>
              {student.section ? (
                <>
                  <View style={styles.dot} />
                  <View style={styles.metaItem}>
                    <Ionicons name="albums-outline" size={13} color="#5b6678" />
                    <Text style={styles.metaText}>شعبة {student.section}</Text>
                  </View>
                </>
              ) : null}
            </View>
            {(student.phone || student.email || (student as any).nationality) && (
              <View style={styles.studentSubRow}>
                {(student as any).nationality ? (
                  <View style={styles.metaItem}>
                    <Ionicons name="flag-outline" size={13} color="#5b6678" />
                    <Text style={styles.metaText}>{(student as any).nationality}</Text>
                  </View>
                ) : null}
                {student.phone ? (
                  <View style={styles.metaItem}>
                    {(student as any).nationality ? <View style={styles.dot} /> : null}
                    <Ionicons name="call-outline" size={13} color="#5b6678" />
                    <Text style={styles.metaText}>{student.phone}</Text>
                  </View>
                ) : null}
                {student.email ? (
                  <>
                    {student.phone ? <View style={styles.dot} /> : null}
                    <View style={styles.metaItem}>
                      <Ionicons name="mail-outline" size={13} color="#5b6678" />
                      <Text style={styles.metaText}>{student.email}</Text>
                    </View>
                  </>
                ) : null}
              </View>
            )}
          </View>
          <View style={styles.studentIconBg}>
            <Ionicons name="school" size={32} color="#2962ff" />
          </View>
        </View>

        {/* ============ بطاقات الإحصائيات المدمجة ============ */}
        <View style={styles.compactStatsRow}>
          <View style={[styles.compactStatChip]}>
            <Ionicons name="book" size={14} color="#2962ff" />
            <Text style={styles.compactStatValue}>{courses.length}</Text>
            <Text style={styles.compactStatLabel}>مقرر</Text>
          </View>
          <View style={styles.compactStatChip}>
            <Ionicons name="time" size={14} color="#e65100" />
            <Text style={styles.compactStatValue}>{totalCreditHours}</Text>
            <Text style={styles.compactStatLabel}>س معتمدة</Text>
          </View>
          <View style={styles.compactStatChip}>
            <Ionicons name={isAccountActive ? 'checkmark-circle' : 'close-circle'} size={14} color={isAccountActive ? '#2e7d32' : '#9e9e9e'} />
            <Text style={[styles.compactStatValue, { color: isAccountActive ? '#2e7d32' : '#9e9e9e' }]}>{isAccountActive ? 'مفعّل' : 'غير مفعّل'}</Text>
            <Text style={styles.compactStatLabel}>الحساب</Text>
          </View>
          {attendanceStats && (
            <>
              <View style={[styles.compactStatChip, { backgroundColor: '#e8f5e9' }]}>
                <Ionicons name="checkmark-circle" size={14} color="#2e7d32" />
                <Text style={[styles.compactStatValue, { color: '#2e7d32' }]}>{attendanceStats.present_count}</Text>
                <Text style={[styles.compactStatLabel, { color: '#2e7d32' }]}>حاضر</Text>
              </View>
              <View style={[styles.compactStatChip, { backgroundColor: '#ffebee' }]}>
                <Ionicons name="close-circle" size={14} color="#c62828" />
                <Text style={[styles.compactStatValue, { color: '#c62828' }]}>{attendanceStats.absent_count}</Text>
                <Text style={[styles.compactStatLabel, { color: '#c62828' }]}>غائب</Text>
              </View>
              <View style={[styles.compactStatChip, { backgroundColor: '#fff3e0' }]}>
                <Ionicons name="time" size={14} color="#e65100" />
                <Text style={[styles.compactStatValue, { color: '#e65100' }]}>{attendanceStats.late_count}</Text>
                <Text style={[styles.compactStatLabel, { color: '#e65100' }]}>متأخر</Text>
              </View>
            </>
          )}
        </View>

        {/* ============ الإجراءات السريعة ============ */}
        {canManage && (
          <View style={styles.actionsCard}>
            <Text style={styles.sectionTitle}>الإجراءات السريعة</Text>
            <View style={styles.actionsGrid}>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: '#fff3e0' }]}
                onPress={openStatusModal}
                testID="change-status-btn"
              >
                <Ionicons name="swap-horizontal" size={18} color="#e65100" />
                <Text style={[styles.actionBtnText, { color: '#e65100' }]}>تغيير الحالة</Text>
              </TouchableOpacity>
              {/* 🆕 زر تخريج الطالب */}
              {!student?.is_alumni && (
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: '#e3f2fd' }]}
                  onPress={() => setShowGraduateModal(true)}
                  testID="graduate-student-btn"
                >
                  <Ionicons name="school" size={18} color="#0d47a1" />
                  <Text style={[styles.actionBtnText, { color: '#0d47a1' }]}>تخريج الطالب</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: '#e8eaf6' }]}
                onPress={openLevelModal}
                testID="change-level-btn"
              >
                <Ionicons name="layers" size={18} color="#3949ab" />
                <Text style={[styles.actionBtnText, { color: '#3949ab' }]}>تغيير المستوى</Text>
              </TouchableOpacity>
              {/* 🔄 نقل الطالب */}
              {!student?.is_alumni && (
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: '#fff3e0' }]}
                  onPress={openTransferModal}
                  testID="transfer-student-btn"
                >
                  <Ionicons name="swap-horizontal" size={18} color="#e65100" />
                  <Text style={[styles.actionBtnText, { color: '#e65100' }]}>نقل الطالب</Text>
                </TouchableOpacity>
              )}
              {isAccountActive ? (
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: '#ffebee' }]}
                  onPress={handleDeactivateAccount}
                  testID="deactivate-account-btn"
                >
                  <Ionicons name="person-remove" size={18} color="#c62828" />
                  <Text style={[styles.actionBtnText, { color: '#c62828' }]}>
                    إلغاء تفعيل الحساب
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: '#e8f5e9' }]}
                  onPress={handleActivateAccount}
                  testID="activate-account-btn"
                >
                  <Ionicons name="person-add" size={18} color="#2e7d32" />
                  <Text style={[styles.actionBtnText, { color: '#2e7d32' }]}>
                    تفعيل الحساب
                  </Text>
                </TouchableOpacity>
              )}
              {isAccountActive && (
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: '#e3f2fd' }]}
                  onPress={handleResetPassword}
                  testID="reset-password-btn"
                >
                  <Ionicons name="key" size={18} color="#1565c0" />
                  <Text style={[styles.actionBtnText, { color: '#1565c0' }]}>
                    إعادة تعيين كلمة المرور
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: '#ede7f6' }]}
                onPress={() =>
                  router.push({
                    pathname: '/report-student',
                    params: { studentId: student.id },
                  })
                }
                testID="open-report-btn"
              >
                <Ionicons name="document-text" size={18} color="#5e35b1" />
                <Text style={[styles.actionBtnText, { color: '#5e35b1' }]}>التقرير المفصّل</Text>
              </TouchableOpacity>
              {/* 🆕 زر إرسال إشعار / إنذار */}
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: '#fff8e1' }]}
                onPress={openNotifModal}
                testID="send-notification-btn"
              >
                <Ionicons name="notifications" size={18} color="#f57f17" />
                <Text style={[styles.actionBtnText, { color: '#f57f17' }]}>إرسال إشعار</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ============ المقررات ============ */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionCardHeader}>
            <Text style={styles.sectionCardTitle}>المقررات المسجَّلة</Text>
            <Text style={styles.sectionCardCount}>
              <Text style={styles.countAccent}>{courses.length}</Text> مقرر
            </Text>
          </View>

          {courses.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="book-outline" size={56} color="#cfd6e1" />
              <Text style={styles.emptyText}>لا توجد مقررات مسجلة</Text>
            </View>
          ) : (
            <View style={styles.coursesList}>
              {courses.map(course => {
                const courseStats = attendanceByCourse[course.id];
                const rate = courseStats?.attendance_rate;
                const rateColor = rate == null ? '#8a95a8'
                  : rate >= 75 ? '#2e7d32'
                  : rate >= 50 ? '#e65100'
                  : '#c62828';
                const rateBg = rate == null ? '#f0f2f6'
                  : rate >= 75 ? '#e8f5e9'
                  : rate >= 50 ? '#fff3e0'
                  : '#ffebee';
                const isExpanded = expandedCourseId === course.id;
                const isLoading = loadingCourseId === course.id;
                const records = courseRecordsCache[course.id] || [];
                return (
                <View key={course.id} style={{ gap: 0 }}>
                  <TouchableOpacity
                    style={[styles.courseRow, isExpanded && styles.courseRowExpanded]}
                    onPress={() => toggleCourseAttendance(course.id)}
                    testID={`course-row-${course.id}`}
                  >
                    <View style={styles.courseIconBox}>
                      <Ionicons name="book" size={20} color="#2962ff" />
                    </View>
                    <View style={styles.courseInfo}>
                      <View style={styles.courseTitleRow}>
                        <Text style={styles.courseName} numberOfLines={1}>
                          {course.name}
                        </Text>
                        <Text style={styles.courseCode}>{course.code || '—'}</Text>
                      </View>
                      <View style={styles.metaRow}>
                        {course.teacher_name ? (
                          <View style={styles.metaItem}>
                            <Ionicons name="person-outline" size={12} color="#5b6678" />
                            <Text style={styles.metaText}>{course.teacher_name}</Text>
                          </View>
                        ) : null}
                        <View style={[styles.badge, styles.badgeLevel]}>
                          <Text style={styles.badgeText}>م{course.level}</Text>
                        </View>
                        {!!course.section && (
                          <View style={[styles.badge, styles.badgeSection]}>
                            <Text style={styles.badgeText}>شعبة {course.section}</Text>
                          </View>
                        )}
                        <View style={[styles.badge, styles.badgeHours]}>
                          <Ionicons name="time-outline" size={10} color="#e65100" />
                          <Text style={[styles.badgeText, { color: '#e65100' }]}>
                            {course.credit_hours} س
                          </Text>
                        </View>
                      </View>
                    </View>
                    <View style={[styles.courseRatePill, { backgroundColor: rateBg }]}>
                      <Text style={[styles.courseRateValue, { color: rateColor }]}>
                        {rate == null ? '—' : `${rate}%`}
                      </Text>
                      <Text style={[styles.courseRateLabel, { color: rateColor }]}>حضور</Text>
                      {courseStats && (
                        <Text style={styles.courseRateSub}>
                          {courseStats.present_count}/{courseStats.total_sessions}
                        </Text>
                      )}
                    </View>
                    <Ionicons
                      name={isExpanded ? 'chevron-down' : 'chevron-back'}
                      size={18}
                      color="#c0c8d4"
                    />
                  </TouchableOpacity>
                  {isExpanded && (
                    <View style={styles.expandedAttendance} testID={`expanded-attendance-${course.id}`}>
                      <View style={styles.expandedHeader}>
                        <Ionicons name="calendar" size={14} color="#1565c0" />
                        <Text style={styles.expandedTitle}>
                          سجل حضور الطالب في "{course.name}"
                        </Text>
                      </View>
                      {isLoading ? (
                        <View style={styles.expandedLoading}>
                          <ActivityIndicator size="small" color="#2962ff" />
                          <Text style={styles.metaText}>جاري تحميل السجلات...</Text>
                        </View>
                      ) : records.length === 0 ? (
                        <Text style={styles.noAttendance}>لا توجد محاضرات مسجلة لهذا المقرر</Text>
                      ) : (
                        <View style={{ gap: 6 }}>
                          {records.map(r => {
                            const isP = r.status === 'present';
                            const isL = r.status === 'late';
                            const isE = r.status === 'excused';
                            const color = isP ? '#2e7d32' : isL ? '#e65100' : isE ? '#1565c0' : '#c62828';
                            const bg = isP ? '#e8f5e9' : isL ? '#fff3e0' : isE ? '#e3f2fd' : '#ffebee';
                            const label = isP ? 'حاضر' : isL ? 'متأخر' : isE ? 'بعذر' : 'غائب';
                            return (
                              <View key={r.id} style={styles.miniRecordRow}>
                                <View style={[styles.attStatusPill, { backgroundColor: bg }]}>
                                  <Text style={[styles.attStatusText, { color }]}>{label}</Text>
                                </View>
                                <Text style={styles.attDate}>
                                  {formatGregorianDate(new Date(r.date))}
                                  {r.start_time ? ` · ${r.start_time}-${r.end_time}` : ''}
                                </Text>
                                {r.method ? (
                                  <View style={styles.miniMethodPill}>
                                    <Text style={styles.miniMethodText}>{r.method}</Text>
                                  </View>
                                ) : null}
                              </View>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  )}
                </View>
                );
              })}
            </View>
          )}
        </View>

        {/* ============ 🆕 سجل الإشعارات/الإنذارات — قابل للطي ============ */}
        <View style={styles.sectionCard}>
          <TouchableOpacity
            style={styles.sectionCardHeader}
            onPress={() => setNotifsExpanded(v => !v)}
            activeOpacity={0.7}
            testID="toggle-notifs-section"
          >
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8, flex: 1 }}>
              <Ionicons
                name={notifsExpanded ? 'chevron-down' : 'chevron-back'}
                size={18}
                color="#5b6678"
              />
              <Text style={styles.sectionCardTitle}>سجل الإشعارات</Text>
              {/* شارة عدد الإشعارات */}
              <View style={styles.notifCountChip}>
                <Text style={styles.notifCountChipText}>{studentNotifications.length}</Text>
              </View>
              {/* شارة الإشعارات غير المقروءة */}
              {studentNotifications.filter(n => !n.is_read).length > 0 && (
                <View style={styles.notifUnreadChip}>
                  <Text style={styles.notifUnreadChipText}>
                    {studentNotifications.filter(n => !n.is_read).length} جديد
                  </Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
          {notifsExpanded && (
            <>
              {notifsLoading ? (
                <View style={{ paddingVertical: 20, alignItems: 'center' }}>
                  <ActivityIndicator size="small" color="#f57f17" />
                </View>
              ) : studentNotifications.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Ionicons name="notifications-off-outline" size={48} color="#cfd6e1" />
                  <Text style={styles.emptyText}>لا توجد إشعارات لهذا الطالب</Text>
                </View>
              ) : (
                <View style={{ gap: 10, paddingHorizontal: 14, paddingBottom: 14 }}>
                  {studentNotifications.map((n) => {
                const color =
                  n.type === 'warning' ? '#f57f17'
                  : n.type === 'absence' ? '#c62828'
                  : n.type === 'announcement' ? '#1565c0'
                  : '#5e35b1';
                const bg =
                  n.type === 'warning' ? '#fff8e1'
                  : n.type === 'absence' ? '#ffebee'
                  : n.type === 'announcement' ? '#e3f2fd'
                  : '#ede7f6';
                const icon: any =
                  n.type === 'warning' ? 'warning'
                  : n.type === 'absence' ? 'alert-circle'
                  : n.type === 'announcement' ? 'megaphone'
                  : 'information-circle';
                return (
                  <View key={n.id} style={[styles.notifCard, { backgroundColor: bg, borderRightColor: color }]} testID={`notif-${n.id}`}>
                    <View style={styles.notifHeader}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                        <Ionicons name={icon} size={16} color={color} />
                        <Text style={[styles.notifTitle, { color }]} numberOfLines={1}>{n.title}</Text>
                      </View>
                      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
                        {n.is_read ? (
                          <View style={[styles.notifBadge, { backgroundColor: '#e8f5e9' }]}>
                            <Text style={[styles.notifBadgeText, { color: '#2e7d32' }]}>مقروء</Text>
                          </View>
                        ) : (
                          <View style={[styles.notifBadge, { backgroundColor: '#fbe9e7' }]}>
                            <Text style={[styles.notifBadgeText, { color: '#d84315' }]}>جديد</Text>
                          </View>
                        )}
                        {canSendNotifications && (
                          <TouchableOpacity
                            onPress={() => handleDeleteNotification(n)}
                            style={styles.notifDeleteBtn}
                            testID={`delete-notif-${n.id}`}
                          >
                            <Ionicons name="trash-outline" size={15} color="#c62828" />
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                    <Text style={styles.notifMessage}>{n.message}</Text>
                    <View style={styles.notifFooter}>
                      <Text style={styles.notifMeta}>{formatGregorianDate(new Date(n.created_at))}</Text>
                      {n.sent_by_name ? (
                        <Text style={styles.notifMeta}>· بواسطة: {n.sent_by_name}</Text>
                      ) : null}
                      {n.is_manual ? (
                        <Text style={[styles.notifMeta, { color: '#5e35b1' }]}>· يدوي</Text>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
            </>
          )}
        </View>

        {/* ============ سجل الحضور التفصيلي (يدوي) ============ */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionCardHeader}>
            <Text style={styles.sectionCardTitle}>سجل الحضور التفصيلي</Text>
            {!showRecords && (
              <TouchableOpacity
                style={[styles.headerBtn, styles.btnGhost, { paddingVertical: 6, paddingHorizontal: 10 }]}
                onPress={handleLoadAttendanceRecords}
                disabled={recordsLoading}
                testID="load-attendance-records-btn"
              >
                {recordsLoading ? (
                  <ActivityIndicator size="small" color="#1a2540" />
                ) : (
                  <Ionicons name="list" size={14} color="#1a2540" />
                )}
                <Text style={[styles.btnGhostText, { fontSize: 12 }]}>
                  {recordsLoading ? '...' : 'تحميل السجلات'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
          {showRecords && (
            <View style={{ padding: 14 }}>
              {attendanceRecords.length === 0 ? (
                <Text style={styles.noAttendance}>لا توجد سجلات حضور</Text>
              ) : (
                attendanceRecords.slice(0, 100).map(record => {
                    const isPresent = record.status === 'present';
                    const isLate = record.status === 'late';
                    const statusColor = isPresent ? '#2e7d32'
                      : isLate ? '#e65100'
                      : record.status === 'excused' ? '#1565c0'
                      : '#c62828';
                    const statusBg = isPresent ? '#e8f5e9'
                      : isLate ? '#fff3e0'
                      : record.status === 'excused' ? '#e3f2fd'
                      : '#ffebee';
                    const statusLabel = isPresent ? 'حاضر'
                      : isLate ? 'متأخر'
                      : record.status === 'excused' ? 'بعذر'
                      : 'غائب';
                    return (
                      <View key={record.id} style={styles.attendanceRow}>
                        <View style={[styles.attStatusPill, { backgroundColor: statusBg }]}>
                          <Text style={[styles.attStatusText, { color: statusColor }]}>
                            {statusLabel}
                          </Text>
                        </View>
                        <View style={{ flex: 1, alignItems: 'flex-end' }}>
                          <Text style={styles.attCourseName}>{record.course_name}</Text>
                          <Text style={styles.attDate}>
                            {formatGregorianDate(new Date(record.date))}
                            {record.start_time ? ` · ${record.start_time} - ${record.end_time}` : ''}
                          </Text>
                        </View>
                      </View>
                    );
                  })
              )}
              {attendanceRecords.length > 100 && (
                <Text style={styles.morePill}>
                  عُرضت أول 100 سجل من إجمالي {attendanceRecords.length}
                </Text>
              )}
            </View>
          )}
        </View>
      </ScrollView>

      {/* ============ مودال التعديل ============ */}
      <Modal
        visible={showEditModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowEditModal(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setShowEditModal(false)}
          />
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>تعديل بيانات الطالب</Text>
              <TouchableOpacity onPress={() => setShowEditModal(false)} testID="close-edit-modal">
                <Ionicons name="close" size={22} color="#5b6678" />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ padding: 16 }}>
              <Text style={styles.inputLabel}>الاسم الكامل *</Text>
              <TextInput
                style={styles.input}
                value={editForm.full_name}
                onChangeText={(t) => setEditForm(p => ({ ...p, full_name: t }))}
                placeholder="الاسم الكامل"
                placeholderTextColor="#a8b1c2"
                testID="edit-name-input"
              />
              <Text style={styles.inputLabel}>الهاتف</Text>
              <TextInput
                style={styles.input}
                value={editForm.phone}
                onChangeText={(t) => setEditForm(p => ({ ...p, phone: t }))}
                placeholder="رقم الهاتف"
                placeholderTextColor="#a8b1c2"
                keyboardType="phone-pad"
                testID="edit-phone-input"
              />
              <Text style={styles.inputLabel}>البريد الإلكتروني</Text>
              <TextInput
                style={styles.input}
                value={editForm.email}
                onChangeText={(t) => setEditForm(p => ({ ...p, email: t }))}
                placeholder="البريد الإلكتروني"
                placeholderTextColor="#a8b1c2"
                keyboardType="email-address"
                testID="edit-email-input"
              />
              <View style={{ flexDirection: 'row-reverse', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inputLabel}>المستوى</Text>
                  <View style={styles.levelPickerRow}>
                    {LEVELS.map(lvl => (
                      <TouchableOpacity
                        key={lvl}
                        style={[
                          styles.levelPickerBtn,
                          editForm.level === lvl && styles.levelPickerBtnActive,
                        ]}
                        onPress={() => setEditForm(p => ({ ...p, level: lvl }))}
                      >
                        <Text
                          style={[
                            styles.levelPickerText,
                            editForm.level === lvl && { color: '#fff' },
                          ]}
                        >
                          م{lvl}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inputLabel}>الشعبة</Text>
                  <TextInput
                    style={styles.input}
                    value={editForm.section}
                    onChangeText={(t) => setEditForm(p => ({ ...p, section: t }))}
                    placeholder="الشعبة"
                    placeholderTextColor="#a8b1c2"
                    testID="edit-section-input"
                  />
                </View>
              </View>
            </ScrollView>
            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={[styles.headerBtn, styles.btnGhost]}
                onPress={() => setShowEditModal(false)}
              >
                <Text style={styles.btnGhostText}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.headerBtn, styles.btnPrimary, savingEdit && { opacity: 0.5 }]}
                onPress={handleSaveEdit}
                disabled={savingEdit}
                testID="save-edit-btn"
              >
                {savingEdit ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="checkmark" size={16} color="#fff" />
                )}
                <Text style={styles.btnPrimaryText}>
                  {savingEdit ? 'جاري الحفظ...' : 'حفظ'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ============ مودال تغيير الحالة ============ */}
      <Modal
        visible={showStatusModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowStatusModal(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setShowStatusModal(false)}
          />
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>تغيير حالة الطالب</Text>
              <TouchableOpacity onPress={() => setShowStatusModal(false)} testID="close-status-modal">
                <Ionicons name="close" size={22} color="#5b6678" />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ padding: 16 }}>
              <Text style={styles.inputLabel}>الحالة الجديدة</Text>
              <View style={styles.statusGrid}>
                {STATUS_OPTIONS.map(opt => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[
                      styles.statusOptionBtn,
                      { backgroundColor: opt.bg },
                      newStatus === opt.value && {
                        borderColor: opt.color,
                        borderWidth: 2,
                      },
                    ]}
                    onPress={() => setNewStatus(opt.value)}
                    testID={`status-option-${opt.value}`}
                  >
                    <Ionicons name={opt.icon} size={18} color={opt.color} />
                    <Text style={[styles.statusOptionText, { color: opt.color }]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.inputLabel}>المستوى الجديد (اختياري)</Text>
              <View style={styles.levelPickerRow}>
                {['', ...LEVELS].map(lvl => (
                  <TouchableOpacity
                    key={lvl || 'none'}
                    style={[
                      styles.levelPickerBtn,
                      statusNewLevel === lvl && styles.levelPickerBtnActive,
                    ]}
                    onPress={() => setStatusNewLevel(lvl)}
                  >
                    <Text
                      style={[
                        styles.levelPickerText,
                        statusNewLevel === lvl && { color: '#fff' },
                      ]}
                    >
                      {lvl ? `م${lvl}` : 'بدون'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.inputLabel}>السبب (اختياري)</Text>
              <TextInput
                style={[styles.input, { height: 80 }]}
                value={statusReason}
                onChangeText={setStatusReason}
                placeholder="سبب تغيير الحالة..."
                placeholderTextColor="#a8b1c2"
                multiline
                testID="status-reason-input"
              />
            </ScrollView>
            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={[styles.headerBtn, styles.btnGhost]}
                onPress={() => setShowStatusModal(false)}
              >
                <Text style={styles.btnGhostText}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.headerBtn, styles.btnPrimary, savingStatus && { opacity: 0.5 }]}
                onPress={handleChangeStatus}
                disabled={savingStatus}
                testID="save-status-btn"
              >
                {savingStatus ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="checkmark" size={16} color="#fff" />
                )}
                <Text style={styles.btnPrimaryText}>
                  {savingStatus ? 'جاري الحفظ...' : 'تطبيق'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      {/* ============ مودال تغيير المستوى ============ */}
      <Modal
        visible={showLevelModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLevelModal(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setShowLevelModal(false)}
          />
          <View style={[styles.modalCard, { maxWidth: 420 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>تغيير المستوى الدراسي</Text>
              <TouchableOpacity onPress={() => setShowLevelModal(false)} testID="close-level-modal">
                <Ionicons name="close" size={22} color="#5b6678" />
              </TouchableOpacity>
            </View>
            <View style={{ padding: 16 }}>
              <Text style={styles.inputLabel}>
                المستوى الحالي: <Text style={{ color: '#1a2540', fontWeight: '700' }}>م{student?.level}</Text>
              </Text>
              <Text style={styles.inputLabel}>اختر المستوى الجديد</Text>
              <View style={styles.levelPickerRow}>
                {LEVELS.map(lvl => (
                  <TouchableOpacity
                    key={lvl}
                    style={[
                      styles.levelPickerBtn,
                      { flex: 1 },
                      newLevel === lvl && styles.levelPickerBtnActive,
                    ]}
                    onPress={() => setNewLevel(lvl)}
                    testID={`level-option-${lvl}`}
                  >
                    <Text
                      style={[
                        styles.levelPickerText,
                        newLevel === lvl && { color: '#fff' },
                      ]}
                    >
                      م{lvl}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={[styles.headerBtn, styles.btnGhost]}
                onPress={() => setShowLevelModal(false)}
              >
                <Text style={styles.btnGhostText}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.headerBtn, styles.btnPrimary, savingLevel && { opacity: 0.5 }]}
                onPress={handleSaveLevel}
                disabled={savingLevel}
                testID="save-level-btn"
              >
                {savingLevel ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="checkmark" size={16} color="#fff" />
                )}
                <Text style={styles.btnPrimaryText}>
                  {savingLevel ? 'جاري الحفظ...' : 'تطبيق'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 🆕 ============ مودال تخريج الطالب ============ */}
      <Modal
        visible={showGraduateModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowGraduateModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { maxWidth: 520 }]}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
                <Ionicons name="school" size={20} color="#0d47a1" />
                <Text style={styles.modalTitle}>تخريج الطالب</Text>
              </View>
              <TouchableOpacity onPress={() => setShowGraduateModal(false)} testID="close-graduate-modal">
                <Ionicons name="close" size={22} color="#666" />
              </TouchableOpacity>
            </View>
            <Text style={{ fontSize: 12, color: '#5a6c7d', textAlign: 'right', marginBottom: 12 }}>
              ستُنقل بيانات "{student?.full_name}" إلى قائمة الخريجين مرتبطة بسنة التخرج المختارة.
            </Text>

            <View style={styles.modalBody}>
              {/* سنة التخرج - مطلوب */}
              <Text style={styles.modalLabel}>سنة التخرج * (إلزامي)</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="2025"
                value={gradYear}
                onChangeText={(v) => setGradYear(v.replace(/[^0-9]/g, '').slice(0, 4))}
                keyboardType="numeric"
                maxLength={4}
                testID="grad-year-input"
              />

              {/* الفصل */}
              <Text style={styles.modalLabel}>الفصل الذي تخرّج فيه</Text>
              <View style={{ flexDirection: 'row-reverse', gap: 6, marginBottom: 4 }}>
                {[
                  { v: 'first', label: 'الفصل الأول' },
                  { v: 'second', label: 'الفصل الثاني' },
                  { v: 'summer', label: 'الفصل الصيفي' },
                ].map(s => (
                  <TouchableOpacity
                    key={s.v}
                    onPress={() => setGradSemester(s.v)}
                    style={{
                      flex: 1,
                      paddingVertical: 8,
                      borderRadius: 6,
                      borderWidth: 1.5,
                      borderColor: gradSemester === s.v ? '#0d47a1' : '#e0e7ee',
                      backgroundColor: gradSemester === s.v ? '#0d47a1' : '#fff',
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ color: gradSemester === s.v ? '#fff' : '#333', fontSize: 12, fontWeight: '700' }}>{s.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* تاريخ التخرج */}
              <Text style={styles.modalLabel}>تاريخ التخرج (اختياري)</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="YYYY-MM-DD"
                value={gradDate}
                onChangeText={setGradDate}
                testID="grad-date-input"
              />

              {/* صف ثنائي: GPA + Hours */}
              <View style={{ flexDirection: 'row-reverse', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalLabel}>المعدل التراكمي (0 - 4.0)</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="3.85"
                    value={gradGpa}
                    onChangeText={setGradGpa}
                    keyboardType="decimal-pad"
                    testID="grad-gpa-input"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalLabel}>الساعات المعتمدة</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="132"
                    value={gradHours}
                    onChangeText={(v) => setGradHours(v.replace(/[^0-9]/g, ''))}
                    keyboardType="numeric"
                    testID="grad-hours-input"
                  />
                </View>
              </View>

              {/* رقم الشهادة */}
              <Text style={styles.modalLabel}>رقم الشهادة (اختياري)</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="AHG-2025-XXXX"
                value={gradCertNum}
                onChangeText={setGradCertNum}
                testID="grad-cert-input"
              />

              {/* مرتبة الشرف */}
              <Text style={styles.modalLabel}>التقدير / مرتبة الشرف (اختياري)</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="ممتاز / جيد جداً / مع مرتبة الشرف"
                value={gradHonors}
                onChangeText={setGradHonors}
                testID="grad-honors-input"
              />

              {/* ملاحظات */}
              <Text style={styles.modalLabel}>ملاحظات (اختياري)</Text>
              <TextInput
                style={[styles.modalInput, { minHeight: 50, textAlignVertical: 'top' }]}
                placeholder="..."
                value={gradNotes}
                onChangeText={setGradNotes}
                multiline
                testID="grad-notes-input"
              />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.btnCancel}
                onPress={() => setShowGraduateModal(false)}
                testID="grad-cancel-btn"
              >
                <Text style={styles.btnCancelText}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnPrimary, { backgroundColor: '#0d47a1' }]}
                onPress={handleGraduate}
                disabled={savingGraduate}
                testID="grad-confirm-btn"
              >
                {savingGraduate ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="school" size={16} color="#fff" />
                )}
                <Text style={styles.btnPrimaryText}>
                  {savingGraduate ? 'جاري التخريج...' : 'تأكيد التخريج'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 🔄 ============ مودال نقل الطالب ============ */}
      <Modal
        visible={showTransferModal}
        animationType="fade"
        transparent
        onRequestClose={() => setShowTransferModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
                <Ionicons name="swap-horizontal" size={20} color="#e65100" />
                <Text style={styles.modalTitle}>نقل الطالب</Text>
              </View>
              <TouchableOpacity onPress={() => setShowTransferModal(false)} testID="close-transfer-modal">
                <Ionicons name="close" size={22} color="#666" />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 480 }} contentContainerStyle={{ paddingBottom: 6 }}>
              {/* الوضع الحالي - بطاقة أنيقة */}
              <View style={styles.transferCurrentBox}>
                <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <Ionicons name="location" size={14} color="#e65100" />
                  <Text style={styles.transferSectionTitle}>الوضع الحالي</Text>
                </View>
                <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6 }}>
                  <View style={styles.chipCurrent}><Text style={styles.chipCurrentText}>{departmentName || 'القسم غير محدد'}</Text></View>
                  <View style={styles.chipCurrent}><Text style={styles.chipCurrentText}>المستوى {student?.level ?? '—'}</Text></View>
                  <View style={styles.chipCurrent}><Text style={styles.chipCurrentText}>شعبة {student?.section || '—'}</Text></View>
                </View>
              </View>

              {/* الوجهة الجديدة - عنوان قسم */}
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6, marginTop: 14, marginBottom: 6 }}>
                <Ionicons name="navigate" size={14} color="#1565c0" />
                <Text style={[styles.transferSectionTitle, { color: '#1565c0' }]}>الوجهة الجديدة</Text>
              </View>

              {/* الكلية */}
              <Text style={styles.label}>الكلية الهدف</Text>
              <View style={styles.pickerWrap}>
                <Picker
                  selectedValue={trgFacId}
                  onValueChange={(v) => { setTrgFacId(v); setTrgDeptId(''); }}
                  style={styles.picker as any}
                >
                  <Picker.Item label="-- اختر كلية --" value="" />
                  {transferFaculties.map((f) => (
                    <Picker.Item key={f.id} label={f.name} value={f.id} />
                  ))}
                </Picker>
              </View>

              {/* القسم (يُفلتر حسب الكلية) */}
              <Text style={styles.label}>القسم الهدف</Text>
              <View style={styles.pickerWrap}>
                <Picker
                  selectedValue={trgDeptId}
                  onValueChange={(v) => setTrgDeptId(v)}
                  style={styles.picker as any}
                  enabled={!!trgFacId}
                >
                  <Picker.Item label={trgFacId ? '-- اختر قسماً --' : '-- اختر الكلية أولاً --'} value="" />
                  {transferDepts
                    .filter((d) => !trgFacId || d.faculty_id === trgFacId)
                    .map((d) => (
                      <Picker.Item key={d.id} label={d.name} value={d.id} />
                    ))}
                </Picker>
              </View>

              {/* المستوى + الشعبة */}
              <View style={{ flexDirection: 'row-reverse', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>المستوى</Text>
                  <View style={styles.pickerWrap}>
                    <Picker selectedValue={trgLevel} onValueChange={setTrgLevel} style={styles.picker as any}>
                      {[1,2,3,4,5,6,7,8].map(n => <Picker.Item key={n} label={`المستوى ${n}`} value={String(n)} />)}
                    </Picker>
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>الشعبة</Text>
                  <TextInput
                    style={styles.input}
                    value={trgSection}
                    onChangeText={setTrgSection}
                    placeholder="مثل: أ"
                    testID="transfer-section-input"
                  />
                </View>
              </View>

              {/* السبب (اختياري) */}
              <Text style={styles.label}>سبب النقل (اختياري)</Text>
              <TextInput
                style={[styles.input, { minHeight: 60 }]}
                value={trgReason}
                onChangeText={setTrgReason}
                placeholder="مثل: طلب الطالب، إعادة توزيع شعب..."
                multiline
                testID="transfer-reason-input"
              />

              {/* تنبيه ذكي */}
              <View style={styles.transferInfoBox}>
                <Ionicons name="information-circle" size={16} color="#01579b" />
                <Text style={styles.transferInfoText}>
                  سيتم إلغاء تسجيل المقررات للفصل النشط تلقائياً، وحفظ سجل دائم بهذه العملية.
                </Text>
              </View>

              {/* سجل النقل السابق */}
              {transferHistory.length > 0 && (
                <View style={{ marginTop: 14 }}>
                  <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <Ionicons name="time" size={14} color="#37474f" />
                    <Text style={styles.transferSectionTitle}>سجل النقل السابق ({transferHistory.length})</Text>
                  </View>
                  {transferHistory.slice(0, 5).map((h) => (
                    <View key={h.id} style={styles.historyItem}>
                      <Text style={styles.historyText} numberOfLines={2}>
                        {h.from?.department_name || '—'} م{h.from?.level} ش{h.from?.section || '—'} ← {h.to?.department_name || '—'} م{h.to?.level} ش{h.to?.section || '—'}
                      </Text>
                      <Text style={styles.historyMeta}>
                        {(h.transferred_at || '').slice(0, 10)} • {h.transferred_by_name || '—'}
                        {h.reason ? ` • ${h.reason}` : ''}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: '#eceff1' }]}
                onPress={() => setShowTransferModal(false)}
                disabled={savingTransfer}
              >
                <Text style={{ color: '#37474f', fontWeight: '700' }}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: '#e65100' }]}
                onPress={handleTransfer}
                disabled={savingTransfer}
                testID="confirm-transfer-btn"
              >
                <Text style={{ color: '#fff', fontWeight: '700' }}>
                  {savingTransfer ? 'جاري النقل...' : 'تأكيد النقل'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 🆕 ============ مودال إرسال إشعار ============ */}
      <Modal
        visible={showNotifModal}
        animationType="fade"
        transparent
        onRequestClose={() => setShowNotifModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
                <Ionicons name="notifications" size={20} color="#f57f17" />
                <Text style={styles.modalTitle}>إرسال إشعار للطالب</Text>
              </View>
              <TouchableOpacity onPress={() => setShowNotifModal(false)} testID="close-notif-modal" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={24} color="#5b6678" />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={{ flexGrow: 0 }}
              contentContainerStyle={{ paddingHorizontal: 18, paddingVertical: 16, gap: 14 }}
              showsVerticalScrollIndicator={false}
            >
              {/* نوع الإشعار */}
              <View>
                <Text style={styles.inputLabel}>نوع الإشعار</Text>
                <View style={styles.typeChipsRow}>
                  {[
                    { val: 'warning', label: 'إنذار', color: '#f57f17', bg: '#fff8e1' },
                    { val: 'announcement', label: 'إعلان', color: '#1565c0', bg: '#e3f2fd' },
                    { val: 'absence', label: 'غياب', color: '#c62828', bg: '#ffebee' },
                    { val: 'info', label: 'معلومة', color: '#5e35b1', bg: '#ede7f6' },
                  ].map((opt) => {
                    const active = notifForm.type === opt.val;
                    return (
                      <TouchableOpacity
                        key={opt.val}
                        style={[styles.typeChip, { backgroundColor: active ? opt.bg : '#fff', borderColor: active ? opt.color : '#d6dde6' }]}
                        onPress={() => setNotifForm(p => ({ ...p, type: opt.val }))}
                        testID={`notif-type-${opt.val}`}
                      >
                        <Text style={{ color: active ? opt.color : '#5b6678', fontWeight: active ? '700' : '500', fontSize: 13 }}>{opt.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* العنوان */}
              <View>
                <Text style={styles.inputLabel}>العنوان</Text>
                <TextInput
                  style={styles.input}
                  value={notifForm.title}
                  onChangeText={(t) => setNotifForm(p => ({ ...p, title: t }))}
                  placeholder="مثال: تنبيه بشأن الحضور"
                  placeholderTextColor="#a8b1c2"
                  testID="notif-title-input"
                />
              </View>

              {/* الرسالة */}
              <View>
                <Text style={styles.inputLabel}>نص الإشعار</Text>
                <TextInput
                  style={[styles.input, { minHeight: 130, textAlignVertical: 'top', paddingTop: 10 }]}
                  value={notifForm.message}
                  onChangeText={(t) => setNotifForm(p => ({ ...p, message: t }))}
                  placeholder="اكتب محتوى الإشعار هنا..."
                  placeholderTextColor="#a8b1c2"
                  multiline
                  numberOfLines={5}
                  testID="notif-message-input"
                />
              </View>
            </ScrollView>

            {/* الذيل — أزرار ثابتة عريضة */}
            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.notifCancelBtn}
                onPress={() => setShowNotifModal(false)}
                disabled={sendingNotif}
                testID="cancel-notif-btn"
              >
                <Text style={styles.notifCancelBtnText}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.notifSendBtn, sendingNotif && { opacity: 0.6 }]}
                onPress={handleSendNotification}
                disabled={sendingNotif}
                testID="confirm-send-notif-btn"
              >
                {sendingNotif ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="send" size={16} color="#fff" />
                )}
                <Text style={styles.notifSendBtnText}>
                  {sendingNotif ? 'جاري الإرسال...' : 'إرسال الإشعار'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* نافذة إصدار إفادة الطالب */}
      <Modal visible={statementModal} transparent animationType="fade" onRequestClose={() => setStatementModal(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 20, width: '100%', maxWidth: 480 }} testID="statement-modal">
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={{ fontSize: 16, fontWeight: '800', color: '#1a2540', textAlign: 'right' }}>📄 إصدار إفادة طالب</Text>
              <View style={{ flexDirection: 'row-reverse', gap: 6 }}>
                <TouchableOpacity
                  onPress={() => { setStatementModal(false); router.push(`/statement-settings?facultyId=${student?.faculty_id || ''}`); }}
                  style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, backgroundColor: '#e0f2f1' }}
                  testID="statement-settings-link"
                >
                  <Ionicons name="settings-outline" size={14} color="#00796b" />
                  <Text style={{ fontSize: 11.5, fontWeight: '700', color: '#00796b' }}>إعدادات الكليشة</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { setStatementModal(false); router.push('/statements-log'); }}
                  style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, backgroundColor: '#e3f2fd' }}
                  testID="statements-log-link"
                >
                  <Ionicons name="list-outline" size={14} color="#1565c0" />
                  <Text style={{ fontSize: 11.5, fontWeight: '700', color: '#1565c0' }}>سجل الإفادات</Text>
                </TouchableOpacity>
              </View>
            </View>
            <Text style={{ fontSize: 12, color: '#5b6678', textAlign: 'right', marginBottom: 12, lineHeight: 20 }}>
              ستصدر إفادة رسمية برقم تسلسلي ورمز QR للتحقق باسم: {student?.full_name} — المستوى {student?.level} ({departmentName || ''})
            </Text>
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#1a2540', textAlign: 'right', marginBottom: 4 }}>الجنسية (تُجلب تلقائياً من بيانات الطالب — يمكن تعديلها)</Text>
            <TextInput
              value={statementNationality}
              onChangeText={setStatementNationality}
              placeholder="يمني"
              style={{ borderWidth: 1, borderColor: '#dde3ec', borderRadius: 8, padding: 10, textAlign: 'right', marginBottom: 10, fontSize: 13 }}
              testID="statement-nationality-input"
            />
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#1a2540', textAlign: 'right', marginBottom: 4 }}>الغرض (اختياري)</Text>
            <TextInput
              value={statementPurpose}
              onChangeText={setStatementPurpose}
              placeholder="مثال: تقديمها للسفارة"
              style={{ borderWidth: 1, borderColor: '#dde3ec', borderRadius: 8, padding: 10, textAlign: 'right', marginBottom: 12, fontSize: 13 }}
              testID="statement-purpose-input"
            />
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#1a2540', textAlign: 'right', marginBottom: 4 }}>مدة الصلاحية بالأيام (اختياري — الافتراضي 90 يوماً)</Text>
            <TextInput
              value={statementValidDays}
              onChangeText={(t) => setStatementValidDays(t.replace(/[^0-9]/g, ''))}
              placeholder="مثال: 90"
              keyboardType="numeric"
              style={{ borderWidth: 1, borderColor: '#dde3ec', borderRadius: 8, padding: 10, textAlign: 'right', marginBottom: 12, fontSize: 13 }}
              testID="statement-valid-days-input"
            />
            {lastStatement && (
              <View style={{ backgroundColor: '#e8f5e9', borderRadius: 8, padding: 10, marginBottom: 10 }} testID="statement-issued-info">
                <Text style={{ fontSize: 12.5, fontWeight: '800', color: '#2e7d32', textAlign: 'right' }}>
                  ✅ صدرت الإفادة رقم {lastStatement.number} وتم تنزيل ملف PDF
                </Text>
                <Text style={{ fontSize: 11, color: '#557a5a', textAlign: 'right', marginTop: 4 }} selectable>
                  رابط التحقق: {lastStatement.verify_url}
                </Text>
              </View>
            )}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                onPress={handleIssueStatement}
                disabled={issuingStatement}
                style={{ flex: 1, backgroundColor: '#00796b', borderRadius: 8, padding: 12, alignItems: 'center', opacity: issuingStatement ? 0.6 : 1 }}
                testID="statement-issue-confirm-btn"
              >
                {issuingStatement ? <ActivityIndicator size="small" color="#fff" /> : (
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13.5 }}>إصدار وتنزيل PDF</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setStatementModal(false)}
                style={{ flex: 0.5, borderWidth: 1, borderColor: '#dde3ec', borderRadius: 8, padding: 12, alignItems: 'center' }}
              >
                <Text style={{ color: '#555', fontWeight: '600', fontSize: 13 }}>إغلاق</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f6fb' },

  pageScroll: { padding: 16, paddingBottom: 40, maxWidth: 1440, width: '100%', alignSelf: 'center' },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 18,
    flexWrap: 'wrap',
    gap: 12,
  },
  pageHeaderRight: { alignItems: 'flex-end' },
  pageTitle: { fontSize: 24, fontWeight: '700', color: '#1a2540', textAlign: 'right', marginBottom: 6 },
  statusBadge: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    marginBottom: 6,
  },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },
  breadcrumb: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  breadcrumbLink: { fontSize: 13, color: '#2962ff', fontWeight: '500' },
  breadcrumbCurrent: { fontSize: 13, color: '#8a95a8', fontWeight: '500' },
  pageHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  headerBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 8 },
  btnPrimary: { backgroundColor: '#2962ff' },
  btnExport: { backgroundColor: '#e53935' },
  btnExportExcel: { backgroundColor: '#1b7d3f' },
  btnPrimaryText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  btnGhost: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e3e7ee' },
  btnGhostText: { color: '#1a2540', fontSize: 13, fontWeight: '600' },

  // بطاقة الطالب
  studentCard: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: '#eef1f6',
  },
  studentIconBg: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#e7f0fe',
    alignItems: 'center', justifyContent: 'center',
  },
  studentAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#2962ff',
    alignItems: 'center', justifyContent: 'center',
  },
  studentAvatarText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  studentName: { fontSize: 17, fontWeight: '700', color: '#1a2540', textAlign: 'right' },
  studentSubRow: { flexDirection: 'row-reverse', alignItems: 'center', marginTop: 5, flexWrap: 'wrap', gap: 6 },
  studentSub: { fontSize: 13, color: '#8a95a8' },
  studentSubBold: { fontSize: 13, color: '#1a2540', fontWeight: '700' },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#cfd6e1', marginHorizontal: 4 },

  metaItem: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 12, color: '#5b6678' },

  // Compact stats
  compactStatsRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  compactStatChip: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#eef1f6',
  },
  compactStatValue: { fontSize: 14, fontWeight: '700', color: '#1a2540' },
  compactStatLabel: { fontSize: 11, color: '#8a95a8' },

  // Attendance rate pill (badge at top)
  attendanceRatePill: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14,
    borderWidth: 1.5, marginBottom: 6,
  },
  attendanceRateText: { fontSize: 12, fontWeight: '800' },

  // Per-course attendance pill
  courseRatePill: {
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    minWidth: 60,
  },
  courseRateValue: { fontSize: 14, fontWeight: '800' },
  courseRateLabel: { fontSize: 9, fontWeight: '600' },
  courseRateSub: { fontSize: 9, color: '#8a95a8', marginTop: 1 },

  // Course row expanded inline attendance
  courseRowExpanded: {
    borderColor: '#bdd4fd',
    backgroundColor: '#f6f9ff',
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  expandedAttendance: {
    backgroundColor: '#f6f9ff',
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: '#bdd4fd',
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    padding: 12,
    marginTop: -10,
    paddingTop: 10,
  },
  expandedHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#dde6f5',
  },
  expandedTitle: { fontSize: 13, fontWeight: '700', color: '#1565c0' },
  expandedLoading: { alignItems: 'center', padding: 14, gap: 8 },
  miniRecordRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e9eef6',
  },
  miniMethodPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: '#f0f2f6',
  },
  miniMethodText: { fontSize: 10, color: '#5b6678', fontWeight: '600' },

  // إحصائيات
  statsGrid: { flexDirection: 'row', gap: 14, marginBottom: 18, flexWrap: 'wrap' },
  statCard: { flex: 1, minWidth: 200, backgroundColor: '#fff', borderRadius: 14, padding: 18, flexDirection: 'row-reverse', alignItems: 'center', gap: 14, borderWidth: 1, borderColor: '#eef1f6' },
  statIconWrap: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  statTextCol: { flex: 1, alignItems: 'flex-end' },
  statLabel: { fontSize: 13, color: '#8a95a8', fontWeight: '500', marginBottom: 4 },
  statValue: { fontSize: 22, color: '#1a2540', fontWeight: '700', marginBottom: 2 },
  statSubLabel: { fontSize: 11, color: '#a8b1c2' },

  // الإجراءات
  actionsCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#eef1f6',
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#1a2540', marginBottom: 12, textAlign: 'right' },
  actionsGrid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 10 },
  actionBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  actionBtnText: { fontSize: 13, fontWeight: '600' },

  // أقسام البطاقات
  sectionCard: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#eef1f6', marginBottom: 18 },
  sectionCardHeader: {
    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, borderBottomWidth: 1, borderBottomColor: '#eef1f6',
  },
  sectionCardTitle: { fontSize: 15, fontWeight: '700', color: '#1a2540' },
  sectionCardCount: { fontSize: 12, color: '#5b6678' },
  countAccent: { color: '#2962ff', fontWeight: '700' },

  // المقررات
  coursesList: { padding: 14, gap: 10 },
  inferredBanner: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff3e0',
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
  },
  inferredBannerText: { flex: 1, fontSize: 12, color: '#e65100', textAlign: 'right' },
  courseRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: '#fafbfd',
    borderRadius: 12,
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: '#eef1f6',
  },
  courseIconBox: {
    width: 44, height: 44, borderRadius: 10,
    backgroundColor: '#e7f0fe',
    alignItems: 'center', justifyContent: 'center',
  },
  courseInfo: { flex: 1, alignItems: 'flex-end', gap: 6 },
  courseTitleRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  courseName: { fontSize: 15, fontWeight: '700', color: '#1a2540', textAlign: 'right' },
  courseCode: { fontSize: 12, color: '#8a95a8', fontWeight: '500' },
  metaRow: { flexDirection: 'row-reverse', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  badge: { flexDirection: 'row-reverse', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  badgeText: { fontSize: 11, fontWeight: '700', color: '#1565c0' },
  badgeLevel: { backgroundColor: '#e7f0fe' },
  badgeSection: { backgroundColor: '#f3e5f5' },
  badgeHours: { backgroundColor: '#fff3e0' },

  emptyState: { alignItems: 'center', paddingVertical: 50, gap: 12 },
  emptyText: { fontSize: 14, color: '#8a95a8' },
  emptyBox: { alignItems: 'center', paddingVertical: 40, gap: 10 },

  // الإشعارات
  sectionSubCount: { fontSize: 12, color: '#5b6678', fontWeight: '500' },
  // شارات داخل رأس قسم الإشعارات
  notifCountChip: {
    backgroundColor: '#eef1f6',
    paddingHorizontal: 9,
    paddingVertical: 2,
    borderRadius: 10,
    minWidth: 22,
    alignItems: 'center',
  },
  notifCountChipText: { fontSize: 11, fontWeight: '700', color: '#5b6678' },
  notifUnreadChip: {
    backgroundColor: '#fbe9e7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  notifUnreadChipText: { fontSize: 10, fontWeight: '700', color: '#d84315' },
  notifCard: {
    backgroundColor: '#fff8e1',
    borderRadius: 10,
    padding: 12,
    borderRightWidth: 4,
    borderRightColor: '#f57f17',
    gap: 6,
  },
  notifHeader: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  notifTitle: { fontSize: 14, fontWeight: '700', textAlign: 'right' },
  notifMessage: { fontSize: 13, color: '#1a2540', lineHeight: 20, textAlign: 'right' },
  notifFooter: { flexDirection: 'row-reverse', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  notifMeta: { fontSize: 11, color: '#8a95a8' },
  notifBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  notifBadgeText: { fontSize: 10, fontWeight: '700' },
  notifDeleteBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: '#ffebee',
    borderWidth: 1,
    borderColor: '#ffcdd2',
  },
  // أزرار مودال الإشعار (عريضة بإطار محدد)
  notifSendBtn: {
    flex: 1,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: '#f57f17',
  },
  notifSendBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  notifCancelBtn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d6dde6',
  },
  notifCancelBtnText: { color: '#5b6678', fontWeight: '700', fontSize: 14 },
  typeChipsRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  typeChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, borderWidth: 1.5 },

  // الحضور
  attendanceCta: { alignItems: 'center', paddingVertical: 36, paddingHorizontal: 18, gap: 8 },
  ctaTitle: { fontSize: 15, fontWeight: '700', color: '#1a2540', textAlign: 'center' },
  ctaSubtitle: { fontSize: 12, color: '#8a95a8', textAlign: 'center' },
  ratePill: {
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12,
    backgroundColor: '#e7f0fe', borderWidth: 1, borderColor: '#bdd4fd',
  },
  rateText: { fontSize: 12, color: '#1565c0', fontWeight: '700' },
  attendanceStatsGrid: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  attStatCard: {
    flex: 1,
    minWidth: 120,
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    gap: 4,
  },
  attStatValue: { fontSize: 22, fontWeight: '700' },
  attStatLabel: { fontSize: 12, fontWeight: '600' },

  recordsTitle: { fontSize: 14, fontWeight: '700', color: '#1a2540', textAlign: 'right', marginBottom: 10 },
  noAttendance: { fontSize: 13, color: '#8a95a8', textAlign: 'center', padding: 20 },
  attendanceRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    backgroundColor: '#fafbfd',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#eef1f6',
    marginBottom: 8,
  },
  attStatusPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    minWidth: 56,
    alignItems: 'center',
  },
  attStatusText: { fontSize: 12, fontWeight: '700' },
  attCourseName: { fontSize: 13, fontWeight: '700', color: '#1a2540' },
  attDate: { fontSize: 11, color: '#5b6678' },
  morePill: { fontSize: 12, color: '#8a95a8', textAlign: 'center', marginTop: 8 },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(20,30,55,0.45)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    width: '100%',
    maxWidth: 560,
    maxHeight: '85%',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#eef1f6',
  },
  modalHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eef1f6',
  },
  modalTitle: { fontSize: 16, fontWeight: '700', color: '#1a2540' },
  modalFooter: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#eef1f6',
    backgroundColor: '#fafbfd',
  },
  inputLabel: { fontSize: 13, color: '#5b6678', textAlign: 'right', marginBottom: 6, marginTop: 10, fontWeight: '600' },
  input: {
    backgroundColor: '#fafbfd',
    borderWidth: 1,
    borderColor: '#e3e7ee',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: '#1a2540',
    textAlign: 'right',
    outlineStyle: 'none' as any,
  },

  // Status grid
  statusGrid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  statusOptionBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  statusOptionText: { fontSize: 13, fontWeight: '700' },

  // Level picker
  levelPickerRow: { flexDirection: 'row-reverse', gap: 6, flexWrap: 'wrap' },
  levelPickerBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: '#fafbfd',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e3e7ee',
  },
  levelPickerBtnActive: { backgroundColor: '#2962ff', borderColor: '#2962ff' },
  levelPickerText: { fontSize: 13, color: '#1a2540', fontWeight: '600' },

  notFoundWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  notFoundText: { fontSize: 16, color: '#5b6678', marginTop: 12, textAlign: 'center' },

  // 🔄 Transfer modal styles
  label: { fontSize: 13, color: '#5b6678', textAlign: 'right', marginBottom: 6, marginTop: 10, fontWeight: '600' },
  modalBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerWrap: {
    backgroundColor: '#fafbfd',
    borderWidth: 1,
    borderColor: '#e3e7ee',
    borderRadius: 8,
    overflow: 'hidden',
  },
  picker: { color: '#1a2540', height: 42, paddingHorizontal: 8 },
  transferCurrentBox: {
    backgroundColor: '#fff3e0',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderRightWidth: 3,
    borderRightColor: '#e65100',
  },
  transferCurrentText: { fontSize: 13, color: '#5d4037', textAlign: 'right', lineHeight: 20 },
  transferSectionTitle: { fontSize: 13, fontWeight: '800', color: '#37474f', textAlign: 'right', marginBottom: 6 },
  historyItem: {
    backgroundColor: '#fafbfd',
    padding: 10,
    borderRadius: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#eceff1',
  },
  historyText: { fontSize: 12, fontWeight: '700', color: '#1a2540', textAlign: 'right', lineHeight: 18 },
  historyMeta: { fontSize: 11, color: '#78909c', textAlign: 'right', marginTop: 3 },

  // 🆕 Chips & info box للنقل
  chipCurrent: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ffcc80',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  chipCurrentText: { fontSize: 12, color: '#5d4037', fontWeight: '700' },
  transferInfoBox: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#e1f5fe',
    padding: 10,
    borderRadius: 10,
    marginTop: 12,
    borderRightWidth: 3,
    borderRightColor: '#0288d1',
  },
  transferInfoText: { flex: 1, fontSize: 12, color: '#01579b', textAlign: 'right', lineHeight: 18 },
});
