import { goBack } from '../src/utils/navigation';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView,
  FlatList,
  Platform,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { AddStudentForm, emptyStudentForm } from '../src/components/AddStudentForm';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Picker } from '@react-native-picker/picker';
import { departmentsAPI, studentsAPI, attendanceAPI, notificationsAPI, exportAPI } from '../src/services/api';
import api from '../src/services/api';
import { SortableHeader } from '../src/components/SortableHeader';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Department, Student } from '../src/types';
import { LoadingScreen } from '../src/components/LoadingScreen';
import { useAuth, PERMISSIONS } from '../src/contexts/AuthContext';
import { formatGregorianDate } from '../src/utils/dateUtils';

const LEVELS = ['1', '2', '3', '4', '5'];

// حالات الطالب
const STATUS_OPTIONS = [
  { value: 'active', label: 'مستمر', color: '#2e7d32', bg: '#e8f5e9', icon: 'checkmark-circle' as const },
  { value: 'repeat', label: 'إعادة', color: '#ef6c00', bg: '#fff3e0', icon: 'refresh-circle' as const },
  { value: 'graduated', label: 'متخرج', color: '#1565c0', bg: '#e3f2fd', icon: 'school' as const },
  { value: 'expelled', label: 'مفصول', color: '#c62828', bg: '#ffebee', icon: 'close-circle' as const },
  { value: 'frozen', label: 'مجمَّد', color: '#5e35b1', bg: '#ede7f6', icon: 'snow' as const },
];
const getStatusInfo = (s: string) => STATUS_OPTIONS.find(o => o.value === s) ||
  { value: s || 'active', label: 'مستمر', color: '#2e7d32', bg: '#e8f5e9', icon: 'checkmark-circle' as const };

// دالة مساعدة للتأكيد
const showConfirm = (
  title: string, 
  message: string, 
  onConfirm: () => Promise<void> | void, 
  confirmText = 'موافق', 
  destructive = false
) => {
  if (Platform.OS === 'web') {
    const confirmed = window.confirm(`${title}\n\n${message}`);
    if (confirmed) {
      const result = onConfirm();
      if (result instanceof Promise) {
        result.catch(err => console.error('Error:', err));
      }
    }
  } else {
    Alert.alert(title, message, [
      { text: 'إلغاء', style: 'cancel' },
      { 
        text: confirmText, 
        style: destructive ? 'destructive' : 'default', 
        onPress: () => {
          const result = onConfirm();
          if (result instanceof Promise) {
            result.catch(err => console.error('Error:', err));
          }
        }
      },
    ]);
  }
};

const showMessage = (title: string, message: string) => {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
};

export default function StudentsScreen() {
  const router = useRouter();
  const { hasPermission, user, isLoading: authLoading } = useAuth();
  
  const isStudent = user?.role === 'student';
  const canManageStudents = user ? (!isStudent && (hasPermission(PERMISSIONS.MANAGE_STUDENTS) || user.role === 'admin')) : false;
  const { openStudent } = useLocalSearchParams<{ openStudent?: string }>();
  
  useEffect(() => {
    if (!authLoading && isStudent) {
      router.replace('/');
    }
  }, [isStudent, authLoading]);
  
  const [departments, setDepartments] = useState<Department[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  
  // فلاتر
  const [selectedDeptFilter, setSelectedDeptFilter] = useState<string>('');
  const [selectedLevelFilter, setSelectedLevelFilter] = useState<string>('');
  const [selectedSectionFilter, setSelectedSectionFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<'none' | 'name_asc' | 'name_desc' | 'attendance_asc' | 'attendance_desc'>('none');
  const [attendanceMap, setAttendanceMap] = useState<Record<string, number | null>>({});
  
  // Pagination
  const PAGE_SIZE = 10;
  const [currentPage, setCurrentPage] = useState(1);
  
  // تحديد متعدد للحذف
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  
  // عرض تفاصيل الطالب
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [studentAttendance, setStudentAttendance] = useState<any[]>([]);
  const [loadingAttendance, setLoadingAttendance] = useState(false);
  
  // تعديل الطالب
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editFormData, setEditFormData] = useState({
    student_id: '',
    full_name: '',
    phone: '',
    email: '',
    nationality: '',
    level: '1',
    section: '',
    program_code: '',
    enrollment_year: '',
  });
  // أصل بيانات الطالب قبل التعديل (للكشف عن تغيير المستوى)
  const [editOriginalLevel, setEditOriginalLevel] = useState<string>('');
  const [editOriginalSection, setEditOriginalSection] = useState<string>('');

  // إرسال إنذار يدوي
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [warningStudent, setWarningStudent] = useState<Student | null>(null);
  const [warningData, setWarningData] = useState({
    title: '',
    message: '',
    type: 'warning',
  });
  const [sendingWarning, setSendingWarning] = useState(false);

  // 🆕 عدد الإشعارات غير المقروءة لكل طالب
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});

  // حذف آمن
  const [deleteTarget, setDeleteTarget] = useState<Student | null>(null);
  const [deleteInfo, setDeleteInfo] = useState<any>(null);
  const [showSafeDeleteModal, setShowSafeDeleteModal] = useState(false);
  const [deletingStudent, setDeletingStudent] = useState(false);
  const [restoringStudent, setRestoringStudent] = useState(false);
  
  // تغيير المستوى
  const [showLevelModal, setShowLevelModal] = useState(false);
  const [changingLevel, setChangingLevel] = useState(false);
  // المرحلة الثانية من تغيير المستوى الجماعي: اختيار الشعبة
  const [showBulkSectionModal, setShowBulkSectionModal] = useState(false);
  const [pendingBulkLevel, setPendingBulkLevel] = useState<number | null>(null);
  const [bulkSectionMode, setBulkSectionMode] = useState<'keep' | 'set' | 'clear'>('keep');
  const [bulkNewSection, setBulkNewSection] = useState<string>('');

  // تغيير الحالة (مدمج هنا - تخرج/إعادة/فصل/تجميد)
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [statusToApply, setStatusToApply] = useState('repeat');
  const [statusNewLevel, setStatusNewLevel] = useState('');
  const [statusReason, setStatusReason] = useState('');
  const [applyingStatus, setApplyingStatus] = useState(false);
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('');

  // 🆕 التخريج الجماعي
  const [showBulkGraduateModal, setShowBulkGraduateModal] = useState(false);
  const [bulkGradYear, setBulkGradYear] = useState(String(new Date().getFullYear()));
  const [bulkGradSemester, setBulkGradSemester] = useState('second');
  const [bulkGradDate, setBulkGradDate] = useState('');
  const [bulkGradHonors, setBulkGradHonors] = useState('');
  const [bulkGradNotes, setBulkGradNotes] = useState('');
  const [bulkGraduating, setBulkGraduating] = useState(false);

  // 🔄 النقل الجماعي
  const [showBulkTransferModal, setShowBulkTransferModal] = useState(false);
  const [bulkTrgFacs, setBulkTrgFacs] = useState<any[]>([]);
  const [bulkTrgFacId, setBulkTrgFacId] = useState('');
  const [bulkTrgDeptId, setBulkTrgDeptId] = useState('');
  const [bulkTrgLevel, setBulkTrgLevel] = useState('1');
  const [bulkTrgSection, setBulkTrgSection] = useState('');
  const [bulkTrgReason, setBulkTrgReason] = useState('');
  const [bulkTransferring, setBulkTransferring] = useState(false);
  // سجل التاريخ لطالب
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyData, setHistoryData] = useState<any[]>([]);

  // 🆕 إجراءات المقررات: نسخ / نقل / إلغاء تسجيل
  const [enrollActionMode, setEnrollActionMode] = useState<null | 'copy' | 'move' | 'unenroll'>(null);
  const [enrollActionCourses, setEnrollActionCourses] = useState<any[]>([]);
  const [enrollActionSourceId, setEnrollActionSourceId] = useState<string>('');
  const [enrollActionTargetIds, setEnrollActionTargetIds] = useState<string[]>([]);
  const [enrollActionSearch, setEnrollActionSearch] = useState('');
  const [enrollActionLoading, setEnrollActionLoading] = useState(false);
  const [historyFor, setHistoryFor] = useState<any>(null);

  // استيراد الطلاب من Excel
  const [showImportModal, setShowImportModal] = useState(false);
  const [importDept, setImportDept] = useState('');
  const [importLevel, setImportLevel] = useState('');
  const [importSection, setImportSection] = useState('');
  const [importing, setImporting] = useState(false);

  // قائمة العمليات (3 نقاط) لكل صف
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  // عدد العناصر في الصفحة
  const [perPage, setPerPage] = useState(10);

  // ➕ إضافة طالب مفرد
  const [showAddModal, setShowAddModal] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newStudent, setNewStudent] = useState({
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

  const handleAddStudent = async () => {
    if (!newStudent.student_id.trim() || !newStudent.full_name.trim() || !newStudent.department_id) {
      showMessage('بيانات ناقصة', 'يرجى إدخال رقم القيد والاسم والقسم على الأقل');
      return;
    }
    setAdding(true);
    try {
      const body: any = {
        student_id: newStudent.student_id.trim(),
        full_name: newStudent.full_name.trim(),
        department_id: newStudent.department_id,
        level: parseInt(newStudent.level) || 1,
        section: newStudent.section.trim(), // فارغ مسموح
      };
      if (newStudent.phone.trim()) body.phone = newStudent.phone.trim();
      if (newStudent.email.trim()) body.email = newStudent.email.trim();
      if (newStudent.password.trim()) body.password = newStudent.password.trim();
      if (newStudent.program_code.trim()) body.program_code = newStudent.program_code.trim().toUpperCase();
      if (newStudent.enrollment_year.trim()) {
        // قبول 25 أو 2025 — نطبّع للصيغة ذات رقمين
        const ey = newStudent.enrollment_year.trim();
        body.enrollment_year = ey.length === 4 ? ey.slice(-2) : ey;
      }
      const r = await api.post('/students', body);
      const refMsg = r.data?.reference_number ? `\nالرقم المرجعي: ${r.data.reference_number}` : '';
      showMessage('تم', `أُضيف الطالب: ${r.data.full_name}${refMsg}`);
      setShowAddModal(false);
      setNewStudent({ student_id: '', full_name: '', department_id: '', level: '1', section: '', phone: '', email: '', nationality: '', password: '', program_code: '', enrollment_year: '' });
      fetchData();
    } catch (e: any) {
      showMessage('خطأ', e?.response?.data?.detail || 'فشل في إضافة الطالب');
    } finally {
      setAdding(false);
    }
  };

  const fetchData = useCallback(async () => {
    if (!canManageStudents) return;
    
    try {
      // جلب الأقسام أولاً (مستقل عن الطلاب)
      const deptsRes = await departmentsAPI.getAll();
      setDepartments(deptsRes.data);
    } catch (error) {
      console.error('Error fetching departments:', error);
    }

    try {
      const studentsRes = await studentsAPI.getAll();
      setStudents(studentsRes.data);
    } catch (error) {
      console.error('Error fetching students:', error);
      showMessage('خطأ', 'فشل في تحميل بيانات الطلاب');
    } finally {
      setLoading(false);
    }
  }, [canManageStudents]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 🆕 جلب عدد الإشعارات غير المقروءة لكل طالب
  useEffect(() => {
    notificationsAPI.getUnreadCounts()
      .then((r) => setUnreadCounts(r.data?.counts || {}))
      .catch(() => setUnreadCounts({}));
  }, []);

  // إعادة توجيه تلقائي إلى صفحة تفاصيل الطالب عند تمرير ?openStudent=ID
  useEffect(() => {
    if (!openStudent) return;
    router.replace({
      pathname: '/student-details',
      params: { studentId: String(openStudent) },
    } as any);
  }, [openStudent]);

  // تصفية الطلاب
  const filteredStudents = useMemo(() => {
    const filtered = students.filter(student => {
      const matchesDept = !selectedDeptFilter || student.department_id === selectedDeptFilter;
      const matchesLevel = !selectedLevelFilter || String(student.level) === selectedLevelFilter;
      const matchesSection = !selectedSectionFilter || 
        selectedSectionFilter === 'الكل' || 
        student.section === selectedSectionFilter;
      const matchesSearch = !searchQuery || 
        student.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        student.student_id.includes(searchQuery);
      const studentStatus = (student as any).status || (student.is_active === false ? 'inactive' : 'active');
      const matchesStatus = !selectedStatusFilter || studentStatus === selectedStatusFilter;
      
      return matchesDept && matchesLevel && matchesSection && matchesSearch && matchesStatus;
    });
    // 🔤 فرز ديناميكي حسب الحقل المختار
    if (sortBy !== 'none') {
      filtered.sort((a, b) => {
        let cmp = 0;
        if (sortBy.startsWith('name_')) {
          cmp = (a.full_name || '').localeCompare((b.full_name || ''), 'ar');
        } else if (sortBy.startsWith('student_id_')) {
          cmp = (a.student_id || '').localeCompare((b.student_id || ''), 'ar', { numeric: true });
        } else if (sortBy.startsWith('level_')) {
          cmp = ((a.level as number) || 0) - ((b.level as number) || 0);
        } else if (sortBy.startsWith('created_at_')) {
          const ad = new Date((a as any).created_at || 0).getTime();
          const bd = new Date((b as any).created_at || 0).getTime();
          cmp = ad - bd;
        } else if (sortBy.startsWith('attendance_')) {
          const pa = attendanceMap[a.id];
          const pb = attendanceMap[b.id];
          if (pa == null && pb == null) cmp = 0;
          else if (pa == null) return 1;
          else if (pb == null) return -1;
          else cmp = pa - pb;
        }
        return sortBy.endsWith('_desc') ? -cmp : cmp;
      });
    }
    return filtered;
  }, [students, selectedDeptFilter, selectedLevelFilter, selectedSectionFilter, searchQuery, selectedStatusFilter, sortBy, attendanceMap]);

  // الشعب المتاحة
  const availableSections = useMemo(() => {
    const sections = new Set<string>();
    students.forEach(s => {
      if (s.section && (!selectedDeptFilter || s.department_id === selectedDeptFilter)) {
        sections.add(s.section);
      }
    });
    return Array.from(sections).sort();
  }, [students, selectedDeptFilter]);

  // الشعب الموجودة في مستوى معيّن (للاقتراحات عند تغيير المستوى)
  const getSectionsAtLevel = useCallback((deptId: string | undefined, level: string | number) => {
    const sections = new Set<string>();
    const lvl = String(level);
    students.forEach(s => {
      if (s.section && String(s.level) === lvl) {
        if (!deptId || s.department_id === deptId) {
          sections.add(s.section);
        }
      }
    });
    return Array.from(sections).sort();
  }, [students]);

  // 🚀 خريطة الأقسام لتسريع البحث (O(1) بدلاً من O(n) لكل صف)
  const departmentMap = useMemo(() => {
    const m = new Map<string, string>();
    departments.forEach(d => m.set(d.id, d.name));
    return m;
  }, [departments]);

  const getDepartmentName = useCallback((deptId: string) => {
    return departmentMap.get(deptId) || 'غير محدد';
  }, [departmentMap]);

  // تحديد/إلغاء تحديد طالب
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  // تحديد الكل
  const selectAll = () => {
    if (selectedIds.size === filteredStudents.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredStudents.map(s => s.id)));
    }
  };

  // حذف المحدد
  const handleBulkDelete = () => {
    if (selectedIds.size === 0) return;
    
    showConfirm(
      'حذف الطلاب المحددين',
      `هل أنت متأكد من حذف ${selectedIds.size} طالب؟`,
      async () => {
        setDeleting(true);
        try {
          await Promise.all(
            Array.from(selectedIds).map(id => studentsAPI.delete(id))
          );
          showMessage('تم', `تم حذف ${selectedIds.size} طالب`);
          setSelectedIds(new Set());
          setSelectionMode(false);
          fetchData();
        } catch (error) {
          showMessage('خطأ', 'فشل في حذف بعض الطلاب');
        } finally {
          setDeleting(false);
        }
      },
      'حذف',
      true
    );
  };

  // تغيير المستوى الجماعي
  const handleBulkChangeLevel = async (newLevel: number) => {
    if (selectedIds.size === 0) return;
    // المرحلة 1: نُغلق نافذة اختيار المستوى ونفتح نافذة اختيار إجراء الشعبة
    setPendingBulkLevel(newLevel);
    setBulkSectionMode('keep');
    setBulkNewSection('');
    setShowLevelModal(false);
    setShowBulkSectionModal(true);
  };

  // المرحلة 2: تنفيذ تغيير المستوى مع خيار الشعبة
  const submitBulkChangeLevel = async () => {
    if (selectedIds.size === 0 || pendingBulkLevel === null) return;
    if (bulkSectionMode === 'set' && !bulkNewSection.trim()) {
      showMessage('تنبيه', 'يرجى إدخال أو اختيار اسم الشعبة الجديدة');
      return;
    }
    setChangingLevel(true);
    try {
      const token = await AsyncStorage.getItem('token');
      const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
      const body: any = {
        student_ids: Array.from(selectedIds),
        new_level: pendingBulkLevel,
        section_mode: bulkSectionMode,
      };
      if (bulkSectionMode === 'set') body.new_section = bulkNewSection.trim();
      const res = await fetch(`${API_URL}/api/students/bulk-change-level`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        showMessage('نجاح', data.message);
        setShowBulkSectionModal(false);
        setPendingBulkLevel(null);
        setBulkNewSection('');
        setBulkSectionMode('keep');
        setSelectedIds(new Set());
        setSelectionMode(false);
        fetchData();
      } else {
        showMessage('خطأ', data.detail || 'فشل في تغيير المستوى');
      }
    } catch {
      showMessage('خطأ', 'فشل في تغيير المستوى');
    } finally {
      setChangingLevel(false);
    }
  };

  // ======== تغيير الحالة الجماعي (تخرج/إعادة/فصل/تجميد) ========
  const handleBulkChangeStatus = async () => {
    if (selectedIds.size === 0 || !statusToApply) return;
    const so = getStatusInfo(statusToApply);
    if (Platform.OS === 'web' && !window.confirm(
      `تطبيق حالة "${so.label}" على ${selectedIds.size} طالب؟`
    )) return;
    setApplyingStatus(true);
    try {
      const body: any = {
        student_ids: Array.from(selectedIds),
        new_status: statusToApply,
        reason: statusReason || '',
      };
      if (statusNewLevel) body.new_level = parseInt(statusNewLevel);
      const res = await api.post('/student-status/bulk-change', body);
      const data = res.data;
      showMessage('تم', `${data.message}\nنجح: ${data.success_count} | فشل: ${data.failed_count}`);
      setShowStatusModal(false);
      setSelectedIds(new Set());
      setSelectionMode(false);
      setStatusReason('');
      setStatusNewLevel('');
      fetchData();
    } catch (e: any) {
      showMessage('خطأ', e?.response?.data?.detail || 'فشل تغيير الحالة');
    } finally {
      setApplyingStatus(false);
    }
  };

  // 🔄 نقل جماعي — فتح المودال
  const openBulkTransferModal = async () => {
    if (selectedIds.size === 0) {
      showMessage('تنبيه', 'حدّد طلاباً أولاً');
      return;
    }
    try {
      const facs = await api.get('/faculties');
      setBulkTrgFacs(facs.data || []);
    } catch (e: any) {
      showMessage('خطأ', e?.response?.data?.detail || 'فشل تحميل الكليات');
      return;
    }
    setBulkTrgFacId('');
    setBulkTrgDeptId('');
    setBulkTrgLevel('1');
    setBulkTrgSection('');
    setBulkTrgReason('');
    setShowBulkTransferModal(true);
  };

  // 🔄 تنفيذ النقل الجماعي
  const handleBulkTransfer = async () => {
    if (selectedIds.size === 0) return;
    if (!bulkTrgDeptId) { showMessage('خطأ', 'اختر القسم الهدف'); return; }
    const lvl = parseInt(bulkTrgLevel);
    if (isNaN(lvl) || lvl < 1 || lvl > 10) { showMessage('خطأ', 'المستوى غير صالح'); return; }
    if (!bulkTrgSection.trim()) { showMessage('خطأ', 'الشعبة مطلوبة'); return; }
    setBulkTransferring(true);
    try {
      const res = await api.post('/students/bulk-transfer', {
        student_ids: Array.from(selectedIds),
        target_faculty_id: bulkTrgFacId || undefined,
        target_department_id: bulkTrgDeptId,
        target_level: lvl,
        target_section: bulkTrgSection.trim(),
        reason: bulkTrgReason.trim() || undefined,
      });
      const data = res.data;
      showMessage('تم النقل ✅', `نجح: ${data.succeeded} • فشل: ${data.failed_count}`);
      setShowBulkTransferModal(false);
      setSelectedIds(new Set());
      setSelectionMode(false);
      // إعادة تحميل القائمة
      try { (await import('../src/services/api')).studentsAPI.getAll().then((r: any) => setStudents(r.data || [])); } catch {}
    } catch (e: any) {
      showMessage('خطأ', e?.response?.data?.detail || 'فشل النقل');
    } finally {
      setBulkTransferring(false);
    }
  };

  // 🆕 تخريج جماعي

  // 🆕 فتح مودال إجراءات المقررات
  const openEnrollActionModal = async (mode: 'copy' | 'move' | 'unenroll') => {
    if (selectedIds.size === 0) return;
    try {
      const res = await api.get('/courses');
      const list = (res.data || []).filter((c: any) => c.is_active !== false);
      setEnrollActionCourses(list);
    } catch { setEnrollActionCourses([]); }
    setEnrollActionSourceId('');
    setEnrollActionTargetIds([]);
    setEnrollActionSearch('');
    setEnrollActionMode(mode);
  };

  const toggleEnrollActionTarget = (id: string) => {
    setEnrollActionTargetIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const submitEnrollAction = async () => {
    if (!enrollActionMode || selectedIds.size === 0) return;
    const student_ids = Array.from(selectedIds);
    setEnrollActionLoading(true);
    try {
      if (enrollActionMode === 'copy') {
        if (enrollActionTargetIds.length === 0) {
          showMessage('تنبيه', 'اختر مقرراً واحداً على الأقل'); setEnrollActionLoading(false); return;
        }
        const r = await api.post('/enrollments/bulk-copy', { student_ids, target_course_ids: enrollActionTargetIds });
        showMessage('تم', r.data?.message || `تم نسخ ${student_ids.length} طالب`);
      } else if (enrollActionMode === 'move') {
        if (!enrollActionSourceId || enrollActionTargetIds.length === 0) {
          showMessage('تنبيه', 'اختر المقرر المصدر والمقرر الهدف'); setEnrollActionLoading(false); return;
        }
        const r = await api.post('/enrollments/bulk-move', {
          student_ids,
          source_course_id: enrollActionSourceId,
          target_course_id: enrollActionTargetIds[0],
        });
        showMessage('تم', r.data?.message || `تم نقل ${student_ids.length} طالب`);
      } else if (enrollActionMode === 'unenroll') {
        if (enrollActionTargetIds.length === 0) {
          showMessage('تنبيه', 'اختر المقرر لإلغاء التسجيل منه'); setEnrollActionLoading(false); return;
        }
        // إلغاء تسجيل تكراري لكل (طالب × مقرر)
        let removed = 0;
        for (const cid of enrollActionTargetIds) {
          for (const sid of student_ids) {
            try {
              await api.delete(`/enrollments/${cid}/${sid}`);
              removed++;
            } catch { /* silent */ }
          }
        }
        showMessage('تم', `تم إلغاء ${removed} تسجيل`);
      }
      setEnrollActionMode(null);
      setSelectedIds(new Set());
      try { fetchData(); } catch {}
    } catch (e: any) {
      const msg = e?.response?.data?.detail || 'فشلت العملية';
      showMessage('خطأ', msg);
    } finally { setEnrollActionLoading(false); }
  };

  const handleBulkGraduate = async () => {
    if (selectedIds.size === 0) return;
    const year = parseInt(bulkGradYear);
    if (isNaN(year) || year < 2000 || year > 2100) {
      showMessage('خطأ', 'سنة التخرج إلزامية وتكون بين 2000 و 2100');
      return;
    }
    if (Platform.OS === 'web' && !window.confirm(
      `🎓 تخريج ${selectedIds.size} طالب لسنة ${year}؟\nسينتقلون إلى قائمة الخريجين.`
    )) return;
    setBulkGraduating(true);
    try {
      const body: any = {
        student_ids: Array.from(selectedIds),
        graduation_year: year,
      };
      if (bulkGradDate) body.graduation_date = bulkGradDate;
      if (bulkGradSemester) body.graduation_semester = bulkGradSemester;
      if (bulkGradHonors) body.honors = bulkGradHonors;
      if (bulkGradNotes) body.notes = bulkGradNotes;
      const res = await api.post('/students/bulk-graduate', body);
      const d = res.data;
      const failedTxt = d.failed?.length ? `\nفشل: ${d.failed.length}` : '';
      const skippedTxt = d.skipped?.length ? `\nتُجاوز: ${d.skipped.length}` : '';
      // 🆕 عرض تفصيلي لأسماء الطلاب الذين فشلوا مع السبب
      let detailsTxt = '';
      if (d.failed?.length) {
        const items = d.failed.slice(0, 5).map((f: any) => `• ${f.name || f.id}: ${f.error || 'خطأ'}`).join('\n');
        detailsTxt += `\n\n❌ فشل:\n${items}${d.failed.length > 5 ? `\n... و${d.failed.length - 5} آخر` : ''}`;
      }
      if (d.skipped?.length) {
        const items = d.skipped.slice(0, 5).map((f: any) => `• ${f.name || f.id}: ${f.reason || ''}`).join('\n');
        detailsTxt += `\n\n⚠️ تجاوز:\n${items}${d.skipped.length > 5 ? `\n... و${d.skipped.length - 5} آخر` : ''}`;
      }
      showMessage('تم', `${d.message}${failedTxt}${skippedTxt}${detailsTxt}`);
      setShowBulkGraduateModal(false);
      setSelectedIds(new Set());
      setSelectionMode(false);
      fetchData();
    } catch (e: any) {
      showMessage('خطأ', e?.response?.data?.detail || 'فشل التخريج');
    } finally {
      setBulkGraduating(false);
    }
  };

  // فتح سجل تاريخ الحالة لطالب
  const openHistoryFor = async (student: any) => {
    setHistoryFor(student);
    setShowHistoryModal(true);
    try {
      const res = await api.get(`/student-status/${student.id}/history`);
      setHistoryData(res.data?.items || []);
    } catch {
      setHistoryData([]);
    }
  };

  // حذف طالب واحد - حذف آمن
  const handleDelete = async (studentId: string, studentName: string) => {
    const student = students.find(s => s.id === studentId);
    if (!student) return;
    setDeleteTarget(student);
    setDeleteInfo(null);
    setShowSafeDeleteModal(true);
    
    try {
      const token = await AsyncStorage.getItem('token');
      const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
      const res = await fetch(`${API_URL}/api/students/${studentId}/backup-info`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      setDeleteInfo(data);
    } catch (error) {
      setDeleteInfo({ error: true });
    }
  };

  const confirmSafeDeleteStudent = async () => {
    if (!deleteTarget) return;
    setDeletingStudent(true);
    
    try {
      const token = await AsyncStorage.getItem('token');
      const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
      const res = await fetch(`${API_URL}/api/students/${deleteTarget.id}/safe-delete`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      
      if (res.ok && data.backup) {
        if (Platform.OS === 'web') {
          const blob = new Blob([JSON.stringify(data.backup, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `backup_student_${deleteTarget.full_name}_${new Date().toISOString().split('T')[0]}.json`;
          a.click();
          URL.revokeObjectURL(url);
        }
        
        showMessage('نجاح', `تم حذف "${deleteTarget.full_name}" وتنزيل النسخة الاحتياطية`);
        setShowSafeDeleteModal(false);
        setDeleteTarget(null);
        fetchData();
      } else {
        showMessage('خطأ', data.detail || 'فشل في حذف الطالب');
      }
    } catch (error) {
      showMessage('خطأ', 'فشل في حذف الطالب');
    } finally {
      setDeletingStudent(false);
    }
  };

  const handleRestoreStudent = async () => {
    if (Platform.OS !== 'web') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (!file) return;
      
      setRestoringStudent(true);
      try {
        const text = await file.text();
        const backupData = JSON.parse(text);
        
        if (backupData.backup_type !== 'student_backup') {
          showMessage('خطأ', 'ملف النسخة الاحتياطية غير صالح - يجب أن يكون نسخة طالب');
          setRestoringStudent(false);
          return;
        }
        
        const studentName = backupData.student?.full_name || 'غير معروف';
        const enrollmentsCount = backupData.enrollments?.length || 0;
        const attendanceCount = backupData.attendance?.length || 0;
        
        if (!confirm(`استعادة الطالب "${studentName}"?\n- ${enrollmentsCount} تسجيل\n- ${attendanceCount} سجل حضور`)) {
          setRestoringStudent(false);
          return;
        }
        
        const token = await AsyncStorage.getItem('token');
        const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
        const res = await fetch(`${API_URL}/api/students/restore`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(backupData),
        });
        const data = await res.json();
        
        if (res.ok) {
          showMessage('نجاح', `تم استعادة "${studentName}" بنجاح`);
          fetchData();
        } else {
          showMessage('خطأ', data.detail || 'فشل في الاستعادة');
        }
      } catch (error) {
        showMessage('خطأ', 'فشل في قراءة الملف');
      } finally {
        setRestoringStudent(false);
      }
    };
    
    input.click();
  };

  // استيراد الطلاب من ملف Excel
  const handleImportStudents = async () => {
    if (!importDept) {
      showMessage('خطأ', 'يجب اختيار القسم');
      return;
    }
    if (!importLevel) {
      showMessage('خطأ', 'يجب اختيار المستوى');
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    input.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (!file) return;

      setImporting(true);
      try {
        const formData = new FormData();
        formData.append('file', file);
        let url = `/import/students?department_id=${importDept}&level=${importLevel}`;
        if (importSection) url += `&section=${encodeURIComponent(importSection)}`;
        
        const res = await api.post(url, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });

        let msg = res.data?.message || 'تم الاستيراد';
        if (res.data?.enrolled_courses_msg) {
          msg += '\n' + res.data.enrolled_courses_msg;
        }
        if (res.data?.errors?.length > 0) {
          msg += '\n\nتنبيهات:\n' + res.data.errors.join('\n');
        }
        showMessage('نتيجة الاستيراد', msg);
        setShowImportModal(false);
        fetchData();
      } catch (err: any) {
        showMessage('خطأ', err.response?.data?.detail || 'فشل الاستيراد');
      } finally {
        setImporting(false);
      }
    };
    input.click();
  };

  // تصدير الطلاب إلى Excel حسب الفلاتر الحالية
  const handleExportStudents = async () => {
    try {
      setRestoringStudent(true);

      // إذا كان وضع التحديد مفعّلاً وهناك طلاب مختارون → نصدّرهم فقط
      if (selectionMode && selectedIds.size > 0) {
        const selectedStudents = students.filter(s => selectedIds.has(s.id));
        const facsMap: any = {};
        try {
          const fRes = await api.get('/faculties');
          (fRes.data || []).forEach((f: any) => { facsMap[f.id] = f.name; });
        } catch {}
        const XLSX = await import('xlsx');
        const rows = selectedStudents.map(s => {
          const dept = departments.find(d => d.id === s.department_id);
          const facId = (s as any).faculty_id || (dept as any)?.faculty_id;
          return {
            'الرقم المرجعي': (s as any).reference_number || '',
            'رقم الطالب': s.student_id || '',
            'الاسم الكامل': s.full_name || '',
            'الكلية': facId ? (facsMap[facId] || '') : '',
            'القسم': dept?.name || '',
            'المستوى': s.level || '',
            'الشعبة': s.section || '',
            'البرنامج': (s as any).program_code || '',
            'سنة الالتحاق': (s as any).enrollment_year || '',
            'الجنسية': (s as any).nationality || '',
            'الهاتف': (s as any).phone || '',
            'البريد': (s as any).email || '',
          };
        });
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'الطلاب المحددون');
        XLSX.writeFile(wb, `selected_students_${selectedStudents.length}.xlsx`);
        return;
      }

      // تصدير حسب الفلاتر النشطة (قسم/مستوى/شعبة)
      const params: { department_id?: string; level?: number; section?: string } = {};
      if (selectedDeptFilter) params.department_id = selectedDeptFilter;
      if (selectedLevelFilter) params.level = parseInt(selectedLevelFilter);
      if (selectedSectionFilter) params.section = selectedSectionFilter;

      const res = await exportAPI.exportStudents(params);

      const blob = new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const deptName = selectedDeptFilter
        ? (departments.find(d => d.id === selectedDeptFilter)?.name || 'all').replace(/\s+/g, '_')
        : 'all';
      const levelPart = selectedLevelFilter ? `_L${selectedLevelFilter}` : '';
      const sectionPart = selectedSectionFilter ? `_${selectedSectionFilter}` : '';
      a.download = `students_${deptName}${levelPart}${sectionPart}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      showMessage('نجاح', 'تم تصدير الطلاب بنجاح');
    } catch (err: any) {
      showMessage('خطأ', err.response?.data?.detail || 'فشل التصدير');
    } finally {
      setRestoringStudent(false);
    }
  };

  // تحميل قالب الطلاب
  const handleDownloadTemplate = async () => {
    try {
      const res = await api.get('/template/students', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'students_template.xlsx');
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      showMessage('خطأ', 'فشل تحميل القالب');
    }
  };

  // فتح نموذج الإنذار اليدوي
  const handleOpenWarningModal = (student: Student) => {
    setWarningStudent(student);
    setWarningData({
      title: `⚠️ إنذار للطالب ${student.full_name}`,
      message: '',
      type: 'warning',
    });
    setShowWarningModal(true);
  };

  // إرسال الإنذار اليدوي
  const handleSendWarning = async () => {
    if (!warningStudent || !warningData.message.trim()) {
      showMessage('خطأ', 'يرجى كتابة نص الإنذار');
      return;
    }

    setSendingWarning(true);
    try {
      await notificationsAPI.sendManual({
        student_id: warningStudent.id,
        title: warningData.title,
        message: warningData.message,
        type: warningData.type,
      });
      showMessage('تم', `تم إرسال الإنذار للطالب ${warningStudent.full_name}`);
      setShowWarningModal(false);
      setWarningStudent(null);
      setWarningData({ title: '', message: '', type: 'warning' });
    } catch (error: any) {
      const msg = error.response?.data?.detail || 'فشل في إرسال الإنذار';
      showMessage('خطأ', msg);
    } finally {
      setSendingWarning(false);
    }
  };

  // عرض تفاصيل الطالب - الانتقال إلى الصفحة المخصصة
  const handleViewDetails = (student: Student) => {
    router.push({
      pathname: '/student-details',
      params: { studentId: student.id },
    } as any);
  };

  // فتح نموذج التعديل
  const handleEdit = (student: Student) => {
    setEditingStudent(student);
    setEditFormData({
      student_id: student.student_id || '',
      full_name: student.full_name,
      phone: student.phone || '',
      email: student.email || '',
      nationality: (student as any).nationality || '',
      level: student.level || '1',
      section: student.section || '',
      program_code: (student as any).program_code || '',
      enrollment_year: (student as any).enrollment_year || '',
    });
    setEditOriginalLevel(String(student.level || '1'));
    setEditOriginalSection(student.section || '');
    setShowEditModal(true);
  };

  // حفظ التعديل
  const handleSaveEdit = async () => {
    if (!editingStudent) return;
    
    if (!editFormData.full_name.trim()) {
      showMessage('خطأ', 'يرجى إدخال اسم الطالب');
      return;
    }
    
    setSaving(true);
    try {
      await studentsAPI.update(editingStudent.id, editFormData);
      showMessage('تم', 'تم تحديث بيانات الطالب');
      setShowEditModal(false);
      setEditingStudent(null);
      fetchData();
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || 'فشل في تحديث البيانات';
      showMessage('خطأ', errorMsg);
    } finally {
      setSaving(false);
    }
  };

  // تفعيل حساب الطالب
  const handleActivateAccount = async (student: Student) => {
    showConfirm('تفعيل حساب الطالب', `هل تريد تفعيل حساب ${student.full_name}؟`, async () => {
      try {
        const response = await studentsAPI.activateAccount(student.id);
        showMessage('تم التفعيل بنجاح ✅', `اسم المستخدم: ${response.data.username}\nكلمة المرور: ${student.student_id}`);
        fetchData();
      } catch (error: any) {
        const errorMsg = error.response?.data?.detail || 'فشل في تفعيل الحساب';
        showMessage('خطأ', errorMsg);
      }
    }, 'تفعيل');
  };

  // إلغاء تفعيل حساب الطالب
  const handleDeactivateAccount = async (student: Student) => {
    showConfirm('إلغاء تفعيل الحساب', `هل أنت متأكد من إلغاء تفعيل حساب ${student.full_name}؟`, async () => {
      try {
        await studentsAPI.deactivateAccount(student.id);
        showMessage('تم', 'تم إلغاء تفعيل حساب الطالب');
        fetchData();
      } catch (error: any) {
        const errorMsg = error.response?.data?.detail || 'فشل في إلغاء التفعيل';
        showMessage('خطأ', errorMsg);
      }
    }, 'إلغاء التفعيل', true);
  };

  // تفعيل/إلغاء تفعيل المحددين
  const [bulkLoading, setBulkLoading] = useState(false);
  
  const handleBulkActivateSelected = () => {
    if (selectedIds.size === 0) return;
    const selectedStudents = students.filter(s => selectedIds.has(s.id));
    const inactive = selectedStudents.filter(s => !s.user_id);
    if (inactive.length === 0) {
      showMessage('تنبيه', 'جميع الطلاب المحددين لديهم حسابات مفعلة');
      return;
    }
    showConfirm('تفعيل الحسابات', `سيتم تفعيل ${inactive.length} حساب طالب.\nكلمة المرور = الرقم الجامعي.\n\nمتابعة؟`, async () => {
      setBulkLoading(true);
      try {
        let activated = 0;
        for (const s of inactive) {
          try {
            await studentsAPI.activateAccount(s.id);
            activated++;
          } catch {}
        }
        showMessage('تم التفعيل', `تم تفعيل ${activated} حساب`);
        setSelectedIds(new Set());
        setSelectionMode(false);
        fetchData();
      } catch (error: any) {
        showMessage('خطأ', 'فشل في التفعيل');
      } finally {
        setBulkLoading(false);
      }
    }, 'تفعيل');
  };

  const handleBulkDeactivateSelected = () => {
    if (selectedIds.size === 0) return;
    const selectedStudents = students.filter(s => selectedIds.has(s.id));
    const active = selectedStudents.filter(s => s.user_id);
    if (active.length === 0) {
      showMessage('تنبيه', 'لا يوجد حسابات مفعلة بين المحددين');
      return;
    }
    showConfirm('إلغاء تفعيل الحسابات', `سيتم إلغاء تفعيل ${active.length} حساب.\n\nمتأكد؟`, async () => {
      setBulkLoading(true);
      try {
        let deactivated = 0;
        for (const s of active) {
          try {
            await studentsAPI.deactivateAccount(s.id);
            deactivated++;
          } catch {}
        }
        showMessage('تم', `تم إلغاء تفعيل ${deactivated} حساب`);
        setSelectedIds(new Set());
        setSelectionMode(false);
        fetchData();
      } catch (error: any) {
        showMessage('خطأ', 'فشل في إلغاء التفعيل');
      } finally {
        setBulkLoading(false);
      }
    }, 'إلغاء التفعيل', true);
  };

  // إعادة تعيين كلمة المرور
  const handleResetPassword = (student: Student) => {
    showConfirm('إعادة تعيين كلمة المرور', `ستصبح كلمة المرور الجديدة: ${student.student_id}`, async () => {
      try {
        await studentsAPI.resetPassword(student.id);
        showMessage('تم ✅', `كلمة المرور الجديدة: ${student.student_id}`);
      } catch (error: any) {
        const errorMsg = error.response?.data?.detail || 'فشل في إعادة تعيين كلمة المرور';
        showMessage('خطأ', errorMsg);
      }
    });
  };

  // مساعد لتاريخ التسجيل (مختصر)
  const formatRegDate = useCallback((s: Student) => {
    const raw = (s as any).created_at || (s as any).enrollment_year;
    if (!raw) return '—';
    try {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) {
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      }
    } catch {}
    return String(raw);
  }, []);

  const renderStudent = useCallback(({ item, index }: { item: Student; index: number }) => {
    const isSelected = selectedIds.has(item.id);
    const st = (item as any).status || (item.is_active === false ? 'inactive' : 'active');
    const si = getStatusInfo(st);
    const dept = getDepartmentName(item.department_id);
    const isMenuOpen = openMenuId === item.id;

    return (
      <View dataSet={{ responsive: "table-row" }} style={[styles.tableRow, isSelected && styles.tableRowSelected, index % 2 === 1 && styles.tableRowAlt]}>
        {/* العمود 1: الطالب - أفاتار + اسم */}
        <TouchableOpacity
          style={[styles.colStudent, styles.cellPad]}
          onPress={() => selectionMode ? toggleSelect(item.id) : handleViewDetails(item)}
          onLongPress={() => { if (!selectionMode) { setSelectionMode(true); setSelectedIds(new Set([item.id])); } }}
          activeOpacity={0.7}
        >
          {selectionMode ? (
            <View style={styles.rowCheckbox}>
              <Ionicons name={isSelected ? 'checkbox' : 'square-outline'} size={20} color={isSelected ? '#2962ff' : '#b0bbcc'} />
            </View>
          ) : (
            <View style={styles.avatarCircle}>
              <Ionicons name="person" size={16} color="#1a2540" />
            </View>
          )}
          <Text style={styles.studentNameCell} numberOfLines={1}>{item.full_name}</Text>
          {/* 🆕 شارة الإشعارات غير المقروءة */}
          {unreadCounts[item.id] > 0 && (
            <View style={styles.unreadNotifBadge} testID={`unread-notif-${item.id}`}>
              <Ionicons name="notifications" size={10} color="#fff" />
              <Text style={styles.unreadNotifBadgeText}>{unreadCounts[item.id]}</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* العمود 2: الرقم الجامعي - badge أخضر */}
        <View style={[styles.colUniId, styles.cellPad]}>
          {(item as any).reference_number ? (
            <View style={styles.uniIdBadge}>
              <Text style={styles.uniIdBadgeText}>{(item as any).reference_number}</Text>
            </View>
          ) : (
            <Text style={styles.mutedCell}>—</Text>
          )}
        </View>

        {/* العمود 3: الرقم الداخلي */}
        <View style={[styles.colInner, styles.cellPad]}>
          <Text style={styles.innerIdText}>{item.student_id}</Text>
        </View>

        {/* العمود 4: البرنامج (القسم) */}
        <View style={[styles.colProg, styles.cellPad]}>
          <Text style={styles.progCell} numberOfLines={1}>{dept}</Text>
        </View>

        {/* العمود 5: المستوى */}
        <View style={[styles.colLevel, styles.cellPad]}>
          <Text style={styles.levelCell}>{item.level}{item.section ? ` · ${item.section}` : ''}</Text>
        </View>

        {/* العمود 6: الحالة */}
        <View style={[styles.colStatus, styles.cellPad]}>
          <View style={[styles.statusPill, { backgroundColor: si.bg }]}>
            <Text style={[styles.statusPillText, { color: si.color }]}>{si.label}</Text>
          </View>
        </View>

        {/* العمود 7: تاريخ التسجيل */}
        <View style={[styles.colDate, styles.cellPad]}>
          <Text style={styles.dateCell}>{formatRegDate(item)}</Text>
        </View>

        {/* العمود 8: العمليات (3 نقاط) */}
        <View style={[styles.colActions, styles.cellPad]}>
          <TouchableOpacity
            style={styles.dotsBtn}
            onPress={() => setOpenMenuId(isMenuOpen ? null : item.id)}
            accessibilityLabel="العمليات"
            testID={`row-actions-${item.id}`}
          >
            <Ionicons name="ellipsis-vertical" size={18} color="#5b6678" />
          </TouchableOpacity>
        </View>
      </View>
    );
  }, [selectedIds, selectionMode, canManageStudents, getDepartmentName, openMenuId, formatRegDate, unreadCounts]);

  // الطالب الحالي للقائمة المنبثقة
  const menuStudent = useMemo(() => students.find(s => s.id === openMenuId) || null, [students, openMenuId]);

  // اسم البرنامج المعروض في بطاقة الإحصائيات
  const currentProgramName = useMemo(() => {
    if (!selectedDeptFilter) return 'الكل';
    return departments.find(d => d.id === selectedDeptFilter)?.name || 'الكل';
  }, [selectedDeptFilter, departments]);

  // إعادة تعيين كل الفلاتر
  const handleResetFilters = useCallback(() => {
    setSelectedDeptFilter('');
    setSelectedLevelFilter('');
    setSelectedSectionFilter('');
    setSelectedStatusFilter('');
    setSearchQuery('');
    setSortBy('none');
    setCurrentPage(1);
  }, []);

  // 📊 Lazy-load attendance summary عند اختيار فرز نسبة الحضور
  useEffect(() => {
    if ((sortBy === 'attendance_asc' || sortBy === 'attendance_desc') && Object.keys(attendanceMap).length === 0) {
      (async () => {
        try {
          const res = await api.get('/students-attendance-summary');
          const data = res.data || [];
          const map: Record<string, number | null> = {};
          data.forEach((s: any) => { map[s.id] = s.attendance_pct; });
          setAttendanceMap(map);
        } catch (e) {
          console.error('Failed to load attendance summary:', e);
        }
      })();
    }
  }, [sortBy, attendanceMap]);

  const hasAnyFilter = !!(selectedDeptFilter || selectedLevelFilter || selectedSectionFilter || selectedStatusFilter || searchQuery || sortBy !== 'none');

  if (authLoading || loading) {
    return <LoadingScreen />;
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView dataSet={{ responsiveScrollRoot: "true" }} style={{ flex: 1 }} contentContainerStyle={styles.pageScroll} showsVerticalScrollIndicator={false}>

        {/* === رأس الصفحة: عنوان + breadcrumb + أزرار === */}
        <View dataSet={{ responsive: "page-header" }} style={styles.pageHeader}>
          {/* في RTL: العناصر الأولى تظهر يميناً تلقائياً */}
          <View style={styles.pageHeaderRight}>
            <Text dataSet={{ responsive: "page-title" }} style={styles.pageTitle}>الطلاب</Text>
            <View style={styles.breadcrumb}>
              <TouchableOpacity onPress={() => router.replace('/')}>
                <Text style={styles.breadcrumbLink}>الرئيسية</Text>
              </TouchableOpacity>
              <Ionicons name="chevron-back" size={12} color="#8a95a8" />
              <Text style={styles.breadcrumbCurrent}>الطلاب</Text>
            </View>
          </View>

          {canManageStudents && (
            <View dataSet={{ responsive: "page-header-actions" }} style={styles.pageHeaderActions}>
              <TouchableOpacity
                style={[styles.headerBtn, styles.btnPrimary]}
                onPress={() => { setNewStudent({ student_id: '', full_name: '', department_id: selectedDeptFilter || '', level: selectedLevelFilter || '1', section: selectedSectionFilter || '', phone: '', email: '', password: '', program_code: '', enrollment_year: '' }); setShowAddModal(true); }}
                data-testid="add-student-btn"
              >
                <Ionicons name="add" size={16} color="#fff" />
                <Text style={styles.btnPrimaryText}>إضافة طالب</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.headerBtn, styles.btnSuccess]}
                onPress={() => { setImportDept(''); setImportLevel(''); setImportSection(''); setShowImportModal(true); }}
                data-testid="import-students-btn"
              >
                <Ionicons name="document-text-outline" size={16} color="#fff" />
                <Text style={styles.btnPrimaryText}>استيراد Excel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.headerBtn, styles.btnGhost]}
                onPress={handleExportStudents}
                data-testid="export-students-btn"
              >
                <Ionicons name="download-outline" size={16} color="#1a2540" />
                <Text style={styles.btnGhostText}>تصدير</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* === بطاقات الإحصائيات === */}
        <View dataSet={{ responsive: "stats-grid" }} style={styles.statsGrid}>
          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: '#4caf50' }]}>
              <Ionicons name="people" size={22} color="#fff" />
            </View>
            <View style={styles.statTextCol}>
              <Text style={styles.statLabel}>إجمالي الطلاب</Text>
              <Text style={styles.statValue}>{students.length.toLocaleString('en-US')}</Text>
              <Text style={styles.statSubLabel}>طالب</Text>
            </View>
          </View>

          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: '#29b6f6' }]}>
              <Ionicons name="eye" size={22} color="#fff" />
            </View>
            <View style={styles.statTextCol}>
              <Text style={styles.statLabel}>المعروض حالياً</Text>
              <Text style={styles.statValue}>{filteredStudents.length.toLocaleString('en-US')}</Text>
              <Text style={styles.statSubLabel}>من {students.length.toLocaleString('en-US')} طالب</Text>
            </View>
          </View>

          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: '#ff9800' }]}>
              <Ionicons name="book" size={22} color="#fff" />
            </View>
            <View style={styles.statTextCol}>
              <Text style={styles.statLabel}>البرنامج</Text>
              <Text style={styles.statValue} numberOfLines={1}>{currentProgramName}</Text>
              <Text style={styles.statSubLabel}>البرنامج الحالي</Text>
            </View>
          </View>

          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: '#7c4dff' }]}>
              <Ionicons name="school" size={22} color="#fff" />
            </View>
            <View style={styles.statTextCol}>
              <Text style={styles.statLabel}>المستوى</Text>
              <Text style={styles.statValue}>{selectedLevelFilter || 'الكل'}</Text>
              <Text style={styles.statSubLabel}>المستوى الحالي</Text>
            </View>
          </View>
        </View>

        {/* === بطاقة الفلاتر === */}
        <View style={styles.filterCard}>
          <View dataSet={{ responsive: "filter-row" }} style={styles.filterRow}>
            {/* البحث - يمين */}
            <View style={styles.filterField}>
              <View style={styles.searchBox}>
                <Ionicons name="search" size={16} color="#8a95a8" />
                <TextInput
                  style={styles.searchBoxInput}
                  placeholder="ابحث بالاسم أو الرقم الجامعي..."
                  value={searchQuery}
                  onChangeText={(v) => { setSearchQuery(v); setCurrentPage(1); }}
                  placeholderTextColor="#a8b1c2"
                  testID="search-input"
                />
              </View>
            </View>

            <View style={styles.filterField}>
              <Text style={styles.filterLbl}>البرنامج</Text>
              <View style={styles.dropdown}>
                <Picker
                  selectedValue={selectedDeptFilter}
                  onValueChange={(v) => { setSelectedDeptFilter(v); setCurrentPage(1); }}
                  style={styles.dropdownInner}
                >
                  <Picker.Item label="الكل" value="" />
                  {departments.map(d => <Picker.Item key={d.id} label={d.name} value={d.id} />)}
                </Picker>
              </View>
            </View>

            <View style={[styles.filterField, { maxWidth: 130 }]}>
              <Text style={styles.filterLbl}>المستوى</Text>
              <View style={styles.dropdown}>
                <Picker
                  selectedValue={selectedLevelFilter}
                  onValueChange={(v) => { setSelectedLevelFilter(v); setCurrentPage(1); }}
                  style={styles.dropdownInner}
                >
                  <Picker.Item label="الكل" value="" />
                  {LEVELS.map(l => <Picker.Item key={l} label={l} value={l} />)}
                </Picker>
              </View>
            </View>

            <View style={[styles.filterField, { maxWidth: 130 }]}>
              <Text style={styles.filterLbl}>الشعبة</Text>
              <View style={styles.dropdown}>
                <Picker
                  selectedValue={selectedSectionFilter}
                  onValueChange={(v) => { setSelectedSectionFilter(v); setCurrentPage(1); }}
                  style={styles.dropdownInner}
                >
                  <Picker.Item label="الكل" value="" />
                  {availableSections.map(s => <Picker.Item key={s} label={s} value={s} />)}
                </Picker>
              </View>
            </View>

            <View style={[styles.filterField, { maxWidth: 140 }]}>
              <Text style={styles.filterLbl}>الحالة</Text>
              <View style={styles.dropdown}>
                <Picker
                  selectedValue={selectedStatusFilter}
                  onValueChange={(v) => { setSelectedStatusFilter(v); setCurrentPage(1); }}
                  style={styles.dropdownInner}
                >
                  <Picker.Item label="الكل" value="" />
                  {STATUS_OPTIONS.map(o => <Picker.Item key={o.value} label={o.label} value={o.value} />)}
                </Picker>
              </View>
            </View>

            {/* أزرار اليسار */}
            <View style={styles.filterBtns}>
              <TouchableOpacity
                style={styles.resetBtn}
                onPress={handleResetFilters}
                disabled={!hasAnyFilter}
                data-testid="reset-filters-btn"
              >
                <Ionicons name="refresh" size={13} color={hasAnyFilter ? '#2962ff' : '#a8b1c2'} />
                <Text style={[styles.resetBtnText, !hasAnyFilter && { color: '#a8b1c2' }]}>إعادة تعيين</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.headerBtn, styles.btnPrimary, { paddingHorizontal: 18 }]}>
                <Text style={styles.btnPrimaryText}>تطبيق الفلتر</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* === شريط التحديد (يظهر فقط في وضع التحديد) === */}
        {selectionMode && (
          <View style={styles.selBar}>
            <TouchableOpacity style={styles.selBarItem} onPress={selectAll}>
              <Ionicons name={selectedIds.size === filteredStudents.length && filteredStudents.length > 0 ? 'checkbox' : 'square-outline'} size={18} color="#2962ff" />
              <Text style={styles.selBarText}>تحديد الكل</Text>
            </TouchableOpacity>
            <Text style={styles.selBarCount}>{selectedIds.size} محدد</Text>
            <View style={{ flex: 1 }} />
            {selectedIds.size > 0 && (
              <>
                <TouchableOpacity style={[styles.selActionBtn, { backgroundColor: '#4caf50' }]} onPress={handleBulkActivateSelected} disabled={bulkLoading}>
                  <Ionicons name="person-add" size={14} color="#fff" />
                  <Text style={styles.selActionText}>تفعيل</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.selActionBtn, { backgroundColor: '#ff9800' }]} onPress={handleBulkDeactivateSelected} disabled={bulkLoading}>
                  <Ionicons name="person-remove" size={14} color="#fff" />
                  <Text style={styles.selActionText}>إلغاء تفعيل</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.selActionBtn, { backgroundColor: '#7c4dff' }]} onPress={() => setShowLevelModal(true)} data-testid="bulk-change-level-btn">
                  <Ionicons name="trending-up" size={14} color="#fff" />
                  <Text style={styles.selActionText}>تغيير المستوى</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.selActionBtn, { backgroundColor: '#5e35b1' }]} onPress={() => { setStatusToApply('repeat'); setStatusNewLevel(''); setStatusReason(''); setShowStatusModal(true); }} testID="bulk-change-status-btn">
                  <Ionicons name="shuffle" size={14} color="#fff" />
                  <Text style={styles.selActionText}>تغيير الحالة</Text>
                </TouchableOpacity>
                {/* 🆕 زر التخريج الجماعي */}
                <TouchableOpacity style={[styles.selActionBtn, { backgroundColor: '#0d47a1' }]} onPress={() => setShowBulkGraduateModal(true)} testID="bulk-graduate-btn">
                  <Ionicons name="school" size={14} color="#fff" />
                  <Text style={styles.selActionText}>تخريج جماعي</Text>
                </TouchableOpacity>
                {/* 🔄 زر النقل الجماعي */}
                <TouchableOpacity style={[styles.selActionBtn, { backgroundColor: '#e65100' }]} onPress={() => openBulkTransferModal()} testID="bulk-transfer-btn">
                  <Ionicons name="swap-horizontal" size={14} color="#fff" />
                  <Text style={styles.selActionText}>نقل جماعي</Text>
                </TouchableOpacity>
                {/* 🆕 إجراءات المقررات: نسخ / نقل / إلغاء تسجيل */}
                <TouchableOpacity style={[styles.selActionBtn, { backgroundColor: '#1565c0' }]} onPress={() => openEnrollActionModal('copy')} testID="bulk-copy-course-btn">
                  <Ionicons name="copy" size={14} color="#fff" />
                  <Text style={styles.selActionText}>نسخ إلى مقرر</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.selActionBtn, { backgroundColor: '#f57c00' }]} onPress={() => openEnrollActionModal('move')} testID="bulk-move-course-btn">
                  <Ionicons name="arrow-forward-circle" size={14} color="#fff" />
                  <Text style={styles.selActionText}>نقل إلى مقرر</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.selActionBtn, { backgroundColor: '#c62828' }]} onPress={() => openEnrollActionModal('unenroll')} testID="bulk-unenroll-btn">
                  <Ionicons name="remove-circle" size={14} color="#fff" />
                  <Text style={styles.selActionText}>إلغاء تسجيل</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.selActionBtn, { backgroundColor: '#f44336' }]} onPress={handleBulkDelete} disabled={deleting}>
                  {deleting ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="trash" size={14} color="#fff" />}
                  <Text style={styles.selActionText}>حذف</Text>
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity onPress={() => { setSelectionMode(false); setSelectedIds(new Set()); }}>
              <Text style={styles.selCancelText}>إلغاء</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* === بطاقة الجدول === */}
        {hasAnyFilter ? (
          <View style={styles.tableCard}>
          {/* رأس البطاقة */}
          <View style={styles.tableCardHeader}>
            <Text style={styles.tableCardTitle}>قائمة الطلاب</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              {canManageStudents && !selectionMode && (
                <TouchableOpacity
                  style={styles.selectModeBtn}
                  onPress={() => setSelectionMode(true)}
                  data-testid="enter-selection-mode-btn"
                >
                  <Ionicons name="checkbox-outline" size={14} color="#2962ff" />
                  <Text style={styles.selectModeText}>تحديد</Text>
                </TouchableOpacity>
              )}
              <Text style={styles.tableCardCount}>
                عرض <Text style={styles.tableCardCountAccent}>{filteredStudents.length}</Text> من <Text style={styles.tableCardCountAccent}>{students.length}</Text> طالب
              </Text>
            </View>
          </View>

          {/* رؤوس الأعمدة */}
          <View dataSet={{ responsive: "table-header-row" }} style={styles.tableHeaderRow}>
            <SortableHeader label="الطالب" field="name" currentSort={sortBy === 'none' ? null : sortBy} onSort={(next) => { setSortBy((next as any) || 'none'); setCurrentPage(1); }} containerStyle={[styles.colStudent, styles.cellPad]} />
            <SortableHeader label="الرقم الجامعي" field="student_id" currentSort={sortBy === 'none' ? null : sortBy} onSort={(next) => { setSortBy((next as any) || 'none'); setCurrentPage(1); }} containerStyle={[styles.colUniId, styles.cellPad]} />
            <View style={[styles.colInner, styles.cellPad]}><Text style={styles.thText}>الرقم الداخلي</Text></View>
            <View style={[styles.colProg, styles.cellPad]}><Text style={styles.thText}>البرنامج</Text></View>
            <SortableHeader label="المستوى" field="level" currentSort={sortBy === 'none' ? null : sortBy} onSort={(next) => { setSortBy((next as any) || 'none'); setCurrentPage(1); }} containerStyle={[styles.colLevel, styles.cellPad]} />
            <View style={[styles.colStatus, styles.cellPad]}><Text style={styles.thText}>الحالة</Text></View>
            <SortableHeader label="تاريخ التسجيل" field="created_at" currentSort={sortBy === 'none' ? null : sortBy} onSort={(next) => { setSortBy((next as any) || 'none'); setCurrentPage(1); }} containerStyle={[styles.colDate, styles.cellPad]} />
            <View style={[styles.colActions, styles.cellPad]}><Text style={styles.thText}>العمليات</Text></View>
          </View>

          {/* الصفوف */}
          {filteredStudents.length === 0 ? (
            <View style={styles.tableEmpty}>
              <Ionicons name="people-outline" size={48} color="#cfd6e1" />
              <Text style={styles.tableEmptyText}>{hasAnyFilter ? 'لا توجد نتائج للفلاتر المطبّقة' : 'لا يوجد طلاب'}</Text>
            </View>
          ) : (
            <View>
              {filteredStudents
                .slice((currentPage - 1) * perPage, currentPage * perPage)
                .map((item, index) => (
                  <View key={item.id}>{renderStudent({ item, index })}</View>
                ))}
            </View>
          )}

          {/* تذييل الجدول: pagination */}
          <View dataSet={{ responsive: "table-footer" }} style={styles.tableFooter}>
            <View style={styles.perPageWrap}>
              <Text style={styles.perPageLbl}>عرض في الصفحة</Text>
              <View style={styles.perPageBox}>
                <Picker
                  selectedValue={String(perPage)}
                  onValueChange={(v) => { setPerPage(parseInt(v) || 10); setCurrentPage(1); }}
                  style={styles.perPagePicker}
                >
                  {[10, 25, 50, 100].map(n => <Picker.Item key={n} label={String(n)} value={String(n)} />)}
                </Picker>
              </View>
            </View>

            {Math.ceil(filteredStudents.length / perPage) > 1 && (
              <View style={styles.pagerWrap}>
                <TouchableOpacity
                  style={[styles.pagerNavBtn, currentPage <= 1 && styles.pagerNavBtnDisabled]}
                  onPress={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                >
                  <Ionicons name="chevron-forward" size={14} color={currentPage <= 1 ? '#c0c8d4' : '#1a2540'} />
                  <Text style={[styles.pagerNavText, currentPage <= 1 && { color: '#c0c8d4' }]}>السابق</Text>
                </TouchableOpacity>

                {(() => {
                  const totalPages = Math.ceil(filteredStudents.length / perPage);
                  const pages: (number | 'dots')[] = [];
                  const last = totalPages;
                  pages.push(1);
                  if (currentPage > 4) pages.push('dots');
                  const start = Math.max(2, currentPage - 1);
                  const end = Math.min(last - 1, currentPage + 1);
                  for (let i = start; i <= end; i++) pages.push(i);
                  if (currentPage < last - 3) pages.push('dots');
                  if (last > 1) pages.push(last);
                  return pages.map((p, idx) => p === 'dots' ? (
                    <Text key={`d-${idx}`} style={styles.pagerDots}>...</Text>
                  ) : (
                    <TouchableOpacity key={p} style={[styles.pagerBtn, currentPage === p && styles.pagerBtnActive]} onPress={() => setCurrentPage(p as number)}>
                      <Text style={[styles.pagerBtnText, currentPage === p && styles.pagerBtnTextActive]}>{p}</Text>
                    </TouchableOpacity>
                  ));
                })()}

                <TouchableOpacity
                  style={[styles.pagerNavBtn, currentPage >= Math.ceil(filteredStudents.length / perPage) && styles.pagerNavBtnDisabled]}
                  onPress={() => setCurrentPage(p => Math.min(Math.ceil(filteredStudents.length / perPage), p + 1))}
                  disabled={currentPage >= Math.ceil(filteredStudents.length / perPage)}
                >
                  <Text style={[styles.pagerNavText, currentPage >= Math.ceil(filteredStudents.length / perPage) && { color: '#c0c8d4' }]}>التالي</Text>
                  <Ionicons name="chevron-back" size={14} color={currentPage >= Math.ceil(filteredStudents.length / perPage) ? '#c0c8d4' : '#1a2540'} />
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
        ) : (
          <View style={{ backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#eef1f6', padding: 50, alignItems: 'center', gap: 14 }}>
            <Ionicons name="filter-circle-outline" size={72} color="#cfd6e1" />
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#1a2540', textAlign: 'center' }}>اختر فلتراً لعرض الطلاب</Text>
            <Text style={{ fontSize: 13, color: '#8a95a8', textAlign: 'center', maxWidth: 460, lineHeight: 22 }}>
              ابدأ بتحديد قسم أو مستوى أو حالة، أو اكتب اسم/رقم طالب في حقل البحث أعلاه لعرض النتائج.
            </Text>
            <View style={{ flexDirection: 'row-reverse', gap: 8, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, backgroundColor: '#e3f2fd' }}>
                <Ionicons name="business-outline" size={11} color="#1565c0" />
                <Text style={{ fontSize: 11, color: '#1565c0', fontWeight: '700' }}>القسم</Text>
              </View>
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, backgroundColor: '#f3e5f5' }}>
                <Ionicons name="school-outline" size={11} color="#6a1b9a" />
                <Text style={{ fontSize: 11, color: '#6a1b9a', fontWeight: '700' }}>المستوى</Text>
              </View>
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, backgroundColor: '#e8f5e9' }}>
                <Ionicons name="checkmark-circle-outline" size={11} color="#2e7d32" />
                <Text style={{ fontSize: 11, color: '#2e7d32', fontWeight: '700' }}>الحالة</Text>
              </View>
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, backgroundColor: '#fff3e0' }}>
                <Ionicons name="search-outline" size={11} color="#ef6c00" />
                <Text style={{ fontSize: 11, color: '#ef6c00', fontWeight: '700' }}>البحث</Text>
              </View>
            </View>
          </View>
        )}

      </ScrollView>

      {/* === قائمة العمليات (3 نقاط) - Modal === */}
      {menuStudent && (
        <Modal visible={!!menuStudent} transparent animationType="fade" onRequestClose={() => setOpenMenuId(null)}>
          <View style={styles.modalOverlay}>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setOpenMenuId(null)} />
            <View style={styles.menuModalCard}>
              <View style={styles.menuModalHeader}>
                <Text style={styles.menuModalTitle} numberOfLines={1}>{menuStudent.full_name}</Text>
                <TouchableOpacity onPress={() => setOpenMenuId(null)}>
                  <Ionicons name="close" size={20} color="#5b6678" />
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={styles.menuItem} onPress={() => { setOpenMenuId(null); handleViewDetails(menuStudent); }}>
                <Ionicons name="eye-outline" size={18} color="#2962ff" />
                <Text style={styles.menuText}>عرض التفاصيل</Text>
              </TouchableOpacity>
              {canManageStudents && (
                <TouchableOpacity style={styles.menuItem} onPress={() => { setOpenMenuId(null); handleEdit(menuStudent); }}>
                  <Ionicons name="pencil-outline" size={18} color="#4caf50" />
                  <Text style={styles.menuText}>تعديل</Text>
                </TouchableOpacity>
              )}
              {canManageStudents && (
                <TouchableOpacity style={styles.menuItem} onPress={() => { setOpenMenuId(null); handleOpenWarningModal(menuStudent); }}>
                  <Ionicons name="warning-outline" size={18} color="#f57c00" />
                  <Text style={styles.menuText}>إرسال إنذار</Text>
                </TouchableOpacity>
              )}
              {canManageStudents && (
                <TouchableOpacity style={styles.menuItem} onPress={() => { setOpenMenuId(null); menuStudent.user_id ? handleDeactivateAccount(menuStudent) : handleActivateAccount(menuStudent); }}>
                  <Ionicons name={menuStudent.user_id ? 'person' : 'person-add-outline'} size={18} color={menuStudent.user_id ? '#9e9e9e' : '#4caf50'} />
                  <Text style={styles.menuText}>{menuStudent.user_id ? 'إلغاء تفعيل الحساب' : 'تفعيل الحساب'}</Text>
                </TouchableOpacity>
              )}
              {menuStudent.user_id && canManageStudents && (
                <TouchableOpacity style={styles.menuItem} onPress={() => { setOpenMenuId(null); handleResetPassword(menuStudent); }}>
                  <Ionicons name="key-outline" size={18} color="#ff9800" />
                  <Text style={styles.menuText}>إعادة تعيين كلمة المرور</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.menuItem} onPress={() => { setOpenMenuId(null); openHistoryFor(menuStudent); }}>
                <Ionicons name="time-outline" size={18} color="#5e35b1" />
                <Text style={styles.menuText}>سجل الحالة</Text>
              </TouchableOpacity>
              {canManageStudents && (
                <TouchableOpacity style={[styles.menuItem, styles.menuItemDanger]} onPress={() => { setOpenMenuId(null); handleDelete(menuStudent.id, menuStudent.full_name); }}>
                  <Ionicons name="trash-outline" size={18} color="#f44336" />
                  <Text style={[styles.menuText, { color: '#f44336' }]}>حذف</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </Modal>
      )}

      {/* نافذة إضافة طالب مفرد - مكوّن مشترك */}
      {showAddModal && (
      <Modal visible={showAddModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxWidth: 480, maxHeight: '90%' }]}>
            <AddStudentForm
              mode="standalone"
              values={newStudent}
              onChange={setNewStudent}
              onSubmit={handleAddStudent}
              onCancel={() => setShowAddModal(false)}
              submitting={adding}
              departments={departments.map(d => ({ id: d.id, name: d.name }))}
            />
          </View>
        </View>
      </Modal>
      )}

      {/* نافذة استيراد الطلاب */}
      {showImportModal && (
      <Modal visible={showImportModal} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 24, width: '90%', maxWidth: 450 }}>
            <Text style={{ fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 20, color: '#1a237e' }}>
              استيراد طلاب من Excel
            </Text>
            <Text style={{ fontSize: 13, color: '#666', textAlign: 'center', marginBottom: 16 }}>
              سيتم تسجيل الطلاب تلقائياً في جميع المقررات المطابقة للقسم والمستوى والشعبة
            </Text>

            <Text style={{ fontSize: 14, fontWeight: '600', marginBottom: 6, color: '#333' }}>القسم *</Text>
            <View style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 8, marginBottom: 12 }}>
              <Picker selectedValue={importDept} onValueChange={setImportDept} style={{ height: 44 }}>
                <Picker.Item label="اختر القسم..." value="" />
                {departments.map(d => <Picker.Item key={d.id} label={d.name} value={d.id} />)}
              </Picker>
            </View>

            <Text style={{ fontSize: 14, fontWeight: '600', marginBottom: 6, color: '#333' }}>المستوى *</Text>
            <View style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 8, marginBottom: 12 }}>
              <Picker selectedValue={importLevel} onValueChange={setImportLevel} style={{ height: 44 }}>
                <Picker.Item label="اختر المستوى..." value="" />
                {LEVELS.map(l => <Picker.Item key={l} label={`المستوى ${l}`} value={l} />)}
              </Picker>
            </View>

            <Text style={{ fontSize: 14, fontWeight: '600', marginBottom: 6, color: '#333' }}>الشعبة (اختياري)</Text>
            <View style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 8, marginBottom: 20 }}>
              <Picker selectedValue={importSection} onValueChange={setImportSection} style={{ height: 44 }}>
                <Picker.Item label="كل الشعب" value="" />
                {['أ','ب','ج','د','هـ','و','ز','ح'].map(s => <Picker.Item key={s} label={`شعبة ${s}`} value={s} />)}
              </Picker>
            </View>

            <TouchableOpacity
              style={{ backgroundColor: '#1565c0', padding: 10, borderRadius: 8, marginBottom: 8, alignItems: 'center' }}
              onPress={handleDownloadTemplate}
            >
              <Text style={{ color: '#fff', fontSize: 14 }}>تحميل قالب Excel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={{ backgroundColor: '#2e7d32', padding: 14, borderRadius: 8, marginBottom: 8, alignItems: 'center' }}
              onPress={handleImportStudents}
              disabled={importing}
            >
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: 'bold' }}>
                {importing ? 'جاري الاستيراد...' : 'اختيار ملف Excel والاستيراد'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={{ padding: 12, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: '#ddd' }}
              onPress={() => setShowImportModal(false)}
            >
              <Text style={{ color: '#666', fontSize: 14 }}>إلغاء</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      )}

      {/* نافذة تفاصيل الطالب */}
      {showDetailsModal && (
      <Modal
        visible={showDetailsModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowDetailsModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>تفاصيل الطالب</Text>
              <TouchableOpacity onPress={() => setShowDetailsModal(false)}>
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>
            
            {selectedStudent && (
              <ScrollView style={styles.modalBody}>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>الاسم:</Text>
                  <Text style={styles.detailValue}>{selectedStudent.full_name}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>رقم الطالب:</Text>
                  <Text style={styles.detailValue}>{selectedStudent.student_id}</Text>
                </View>
                {(selectedStudent as any).reference_number && (
                  <View style={[styles.detailRow, { backgroundColor: '#e8f5e9', paddingVertical: 8, paddingHorizontal: 8, borderRadius: 8, marginVertical: 4 }]}>
                    <Text style={[styles.detailLabel, { color: '#2e7d32', fontWeight: '700' as const }]}>الرقم المرجعي:</Text>
                    <Text style={[styles.detailValue, { color: '#2e7d32', fontWeight: '700' as const, fontSize: 14, letterSpacing: 1 }]}>
                      {(selectedStudent as any).reference_number}
                    </Text>
                  </View>
                )}
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>القسم:</Text>
                  <Text style={styles.detailValue}>{getDepartmentName(selectedStudent.department_id)}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>المستوى:</Text>
                  <Text style={styles.detailValue}>م{selectedStudent.level}</Text>
                </View>
                {selectedStudent.section && (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>الشعبة:</Text>
                    <Text style={styles.detailValue}>{selectedStudent.section}</Text>
                  </View>
                )}
                {selectedStudent.phone && (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>الهاتف:</Text>
                    <Text style={styles.detailValue}>{selectedStudent.phone}</Text>
                  </View>
                )}
                {selectedStudent.email && (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>البريد:</Text>
                    <Text style={styles.detailValue}>{selectedStudent.email}</Text>
                  </View>
                )}
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>حالة الحساب:</Text>
                  <Text style={[styles.detailValue, { color: selectedStudent.user_id ? '#4caf50' : '#999' }]}>
                    {selectedStudent.user_id ? 'مفعّل' : 'غير مفعّل'}
                  </Text>
                </View>

                {/* سجل الحضور */}
                <Text style={styles.sectionTitle}>سجل الحضور</Text>
                {loadingAttendance ? (
                  <ActivityIndicator size="small" color="#1565c0" />
                ) : studentAttendance.length > 0 ? (
                  studentAttendance.slice(0, 10).map((record, index) => (
                    <View key={index} style={styles.attendanceRow}>
                      <Text style={styles.attendanceDate}>{formatGregorianDate(new Date(record.date), { includeYear: false })}</Text>
                      <Text style={[styles.attendanceStatus, { color: record.status === 'present' ? '#4caf50' : '#f44336' }]}>
                        {record.status === 'present' ? 'حاضر' : 'غائب'}
                      </Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.noAttendance}>لا يوجد سجل حضور</Text>
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
      )}

      {/* نافذة تعديل الطالب */}
      {showEditModal && (
      <Modal
        visible={showEditModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowEditModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>تعديل بيانات الطالب</Text>
              <TouchableOpacity onPress={() => setShowEditModal(false)}>
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>
            
            <ScrollView style={styles.modalBody}>
              {user?.role === 'admin' && (
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>رقم القيد *</Text>
                  <TextInput
                    style={[styles.input, { fontFamily: 'monospace', fontSize: 15, backgroundColor: '#fff9c4' }]}
                    value={editFormData.student_id}
                    onChangeText={(text) => setEditFormData(prev => ({ ...prev, student_id: text.trim() }))}
                    placeholder="رقم القيد (مثال: 1025037)"
                    placeholderTextColor="#999"
                    autoCapitalize="none"
                    testID="edit-student-id-input"
                  />
                  <Text style={{ fontSize: 11, color: '#f57f17', marginTop: 4, textAlign: 'right' }}>
                    ⚠️ تغيير رقم القيد سيؤثر على تسجيل الدخول (اسم المستخدم سيتحدّث تلقائياً) - متاح للمدير العام فقط
                  </Text>
                </View>
              )}

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>اسم الطالب *</Text>
                <TextInput
                  style={styles.input}
                  value={editFormData.full_name}
                  onChangeText={(text) => setEditFormData(prev => ({ ...prev, full_name: text }))}
                  placeholder="اسم الطالب"
                  placeholderTextColor="#999"
                />
              </View>
              
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>المستوى</Text>
                <View style={styles.pickerContainer}>
                  <Picker
                    selectedValue={editFormData.level}
                    onValueChange={(value) => setEditFormData(prev => ({ ...prev, level: value }))}
                    style={styles.picker}
                  >
                    {LEVELS.map(level => (
                      <Picker.Item key={level} label={`م${level}`} value={level} />
                    ))}
                  </Picker>
                </View>
              </View>
              
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>الشعبة</Text>
                {/* تنبيه عند تغيير المستوى مع وجود شعبة سابقة */}
                {editingStudent && editFormData.level !== editOriginalLevel && editOriginalSection ? (
                  <View
                    data-testid="section-reassign-notice"
                    style={{
                      backgroundColor: '#fff8e1',
                      borderWidth: 1,
                      borderColor: '#ffe082',
                      borderRadius: 8,
                      padding: 10,
                      marginBottom: 8,
                    }}
                  >
                    <Text style={{ fontSize: 12, color: '#795548', textAlign: 'right', marginBottom: 6, fontWeight: '600' }}>
                      ⚠️ تم تغيير المستوى من م{editOriginalLevel} إلى م{editFormData.level}.{'\n'}
                      الشعبة الحالية: <Text style={{ fontWeight: '800' }}>{editOriginalSection}</Text>
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                      <TouchableOpacity
                        data-testid="section-keep-btn"
                        style={{
                          flex: 1,
                          backgroundColor: editFormData.section === editOriginalSection ? '#2e7d32' : '#e8f5e9',
                          padding: 8,
                          borderRadius: 6,
                          alignItems: 'center',
                          minWidth: 90,
                        }}
                        onPress={() => setEditFormData(prev => ({ ...prev, section: editOriginalSection }))}
                      >
                        <Text style={{
                          fontSize: 11,
                          fontWeight: '700',
                          color: editFormData.section === editOriginalSection ? '#fff' : '#2e7d32',
                        }}>
                          احتفظ بـ {editOriginalSection}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        data-testid="section-clear-btn"
                        style={{
                          flex: 1,
                          backgroundColor: editFormData.section === '' ? '#c62828' : '#ffebee',
                          padding: 8,
                          borderRadius: 6,
                          alignItems: 'center',
                          minWidth: 90,
                        }}
                        onPress={() => setEditFormData(prev => ({ ...prev, section: '' }))}
                      >
                        <Text style={{
                          fontSize: 11,
                          fontWeight: '700',
                          color: editFormData.section === '' ? '#fff' : '#c62828',
                        }}>
                          بلا شعبة
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : null}
                {/* اقتراحات الشعب الموجودة في المستوى المختار */}
                {(() => {
                  const suggestions = getSectionsAtLevel(
                    editingStudent?.department_id,
                    editFormData.level
                  );
                  if (!suggestions.length) return null;
                  return (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                      <Text style={{ fontSize: 11, color: '#666', width: '100%', textAlign: 'right' }}>
                        الشعب الموجودة في م{editFormData.level}:
                      </Text>
                      {suggestions.map(sec => (
                        <TouchableOpacity
                          key={sec}
                          data-testid={`section-suggest-${sec}`}
                          onPress={() => setEditFormData(prev => ({ ...prev, section: sec }))}
                          style={{
                            paddingHorizontal: 10,
                            paddingVertical: 5,
                            borderRadius: 12,
                            borderWidth: 1,
                            borderColor: editFormData.section === sec ? '#1976d2' : '#bbdefb',
                            backgroundColor: editFormData.section === sec ? '#1976d2' : '#e3f2fd',
                          }}
                        >
                          <Text style={{
                            fontSize: 12,
                            fontWeight: '700',
                            color: editFormData.section === sec ? '#fff' : '#1976d2',
                          }}>
                            {sec}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  );
                })()}
                <TextInput
                  style={styles.input}
                  value={editFormData.section}
                  onChangeText={(text) => setEditFormData(prev => ({ ...prev, section: text }))}
                  placeholder="الشعبة (اختياري) - أو إدخال يدوي"
                  placeholderTextColor="#999"
                  data-testid="edit-section-input"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>البرنامج</Text>
                <View style={styles.pickerContainer}>
                  <Picker
                    selectedValue={editFormData.program_code}
                    onValueChange={(v) => setEditFormData(prev => ({ ...prev, program_code: v }))}
                    style={styles.picker}
                  >
                    <Picker.Item label="(غير محدد)" value="" />
                    <Picker.Item label="بكالوريوس (B)" value="B" />
                    <Picker.Item label="ماجستير (M)" value="M" />
                    <Picker.Item label="دكتوراه (D)" value="D" />
                    <Picker.Item label="دبلوم (P)" value="P" />
                    <Picker.Item label="عن بُعد (E)" value="E" />
                  </Picker>
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>سنة الالتحاق (مثال: 25)</Text>
                <TextInput
                  style={styles.input}
                  value={editFormData.enrollment_year}
                  onChangeText={(text) => setEditFormData(prev => ({ ...prev, enrollment_year: text.replace(/[^0-9]/g, '').slice(0, 2) }))}
                  placeholder="25 / 26 / 27"
                  placeholderTextColor="#999"
                  keyboardType="number-pad"
                  maxLength={2}
                />
              </View>
              
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>الجنسية</Text>
                <TextInput
                  style={styles.input}
                  value={editFormData.nationality}
                  onChangeText={(text) => setEditFormData(prev => ({ ...prev, nationality: text }))}
                  placeholder="يمني (اختياري)"
                  placeholderTextColor="#999"
                  testID="edit-student-nationality-input"
                />
              </View>
              
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>الهاتف</Text>
                <TextInput
                  style={styles.input}
                  value={editFormData.phone}
                  onChangeText={(text) => setEditFormData(prev => ({ ...prev, phone: text }))}
                  placeholder="رقم الهاتف (اختياري)"
                  placeholderTextColor="#999"
                  keyboardType="phone-pad"
                />
              </View>
              
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>البريد الإلكتروني</Text>
                <TextInput
                  style={styles.input}
                  value={editFormData.email}
                  onChangeText={(text) => setEditFormData(prev => ({ ...prev, email: text }))}
                  placeholder="البريد الإلكتروني (اختياري)"
                  placeholderTextColor="#999"
                  keyboardType="email-address"
                />
              </View>
              
              <TouchableOpacity
                style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
                onPress={handleSaveEdit}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.saveBtnText}>حفظ التغييرات</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
      )}

      {/* نافذة إرسال إنذار يدوي */}
      {showWarningModal && (
      <Modal
        visible={showWarningModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowWarningModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>إرسال إنذار</Text>
              <TouchableOpacity onPress={() => setShowWarningModal(false)}>
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>
            
            <ScrollView style={styles.modalBody}>
              {warningStudent && (
                <View style={styles.warningStudentInfo}>
                  <Ionicons name="person-circle" size={48} color="#f57c00" />
                  <Text style={styles.warningStudentName}>{warningStudent.full_name}</Text>
                  <Text style={styles.warningStudentId}>{warningStudent.student_id}</Text>
                </View>
              )}

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>نوع الإنذار</Text>
                <View style={styles.warningTypeContainer}>
                  <TouchableOpacity
                    style={[
                      styles.warningTypeBtn,
                      warningData.type === 'warning' && styles.warningTypeBtnActive
                    ]}
                    onPress={() => setWarningData(prev => ({ ...prev, type: 'warning' }))}
                  >
                    <Ionicons name="warning" size={20} color={warningData.type === 'warning' ? '#fff' : '#f57c00'} />
                    <Text style={[
                      styles.warningTypeText,
                      warningData.type === 'warning' && styles.warningTypeTextActive
                    ]}>إنذار</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.warningTypeBtn,
                      warningData.type === 'reminder' && styles.warningTypeBtnActiveBlue
                    ]}
                    onPress={() => setWarningData(prev => ({ ...prev, type: 'reminder' }))}
                  >
                    <Ionicons name="notifications" size={20} color={warningData.type === 'reminder' ? '#fff' : '#1976d2'} />
                    <Text style={[
                      styles.warningTypeText,
                      warningData.type === 'reminder' && styles.warningTypeTextActive
                    ]}>تذكير</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>عنوان الإنذار *</Text>
                <TextInput
                  style={styles.input}
                  value={warningData.title}
                  onChangeText={(text) => setWarningData(prev => ({ ...prev, title: text }))}
                  placeholder="عنوان الإنذار"
                  placeholderTextColor="#999"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>نص الإنذار *</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={warningData.message}
                  onChangeText={(text) => setWarningData(prev => ({ ...prev, message: text }))}
                  placeholder="اكتب نص الإنذار هنا..."
                  placeholderTextColor="#999"
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                />
              </View>

              <TouchableOpacity
                style={[styles.sendWarningBtn, sendingWarning && styles.saveBtnDisabled]}
                onPress={handleSendWarning}
                disabled={sendingWarning}
              >
                {sendingWarning ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="send" size={14} color="#fff" />
                    <Text style={styles.sendWarningBtnText}>إرسال الإنذار</Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
      )}
      
      {/* نافذة تغيير المستوى */}
      {showLevelModal && (
      <Modal visible={showLevelModal} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 20, width: '85%', maxWidth: 380 }}>
            <Ionicons name="school" size={36} color="#9c27b0" style={{ alignSelf: 'center', marginBottom: 10 }} />
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#333', textAlign: 'center', marginBottom: 4 }}>
              تغيير المستوى
            </Text>
            <Text style={{ fontSize: 13, color: '#888', textAlign: 'center', marginBottom: 16 }}>
              {selectedIds.size} طالب محدد - اختر المستوى الجديد
            </Text>
            
            {changingLevel ? (
              <ActivityIndicator size="large" color="#9c27b0" style={{ marginVertical: 30 }} />
            ) : (
              <View style={{ gap: 8 }}>
                {[1, 2, 3, 4, 5, 6, 7, 8].map(level => (
                  <TouchableOpacity
                    key={level}
                    style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#f3e5f5', padding: 14, borderRadius: 10, gap: 10 }}
                    onPress={() => handleBulkChangeLevel(level)}
                    data-testid={`select-level-${level}`}
                  >
                    <Ionicons name="trending-up" size={20} color="#9c27b0" />
                    <Text style={{ fontSize: 15, fontWeight: '600', color: '#6a1b9a' }}>المستوى {level}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            
            <TouchableOpacity
              style={{ backgroundColor: '#f5f5f5', padding: 12, borderRadius: 10, alignItems: 'center', marginTop: 12 }}
              onPress={() => setShowLevelModal(false)}
            >
              <Text style={{ color: '#666', fontWeight: '600' }}>إلغاء</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      )}

      {/* نافذة المرحلة 2: اختيار الشعبة عند تغيير المستوى الجماعي */}
      {showBulkSectionModal && (
      <Modal visible={showBulkSectionModal} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 16 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 20, width: '95%', maxWidth: 440 }} data-testid="bulk-section-modal">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: '#f3e5f5', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="people" size={20} color="#9c27b0" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: '800', color: '#222', textAlign: 'right' }}>
                  ماذا عن الشعبة؟
                </Text>
                <Text style={{ fontSize: 11, color: '#888', textAlign: 'right' }}>
                  {selectedIds.size} طالب → المستوى م{pendingBulkLevel}
                </Text>
              </View>
            </View>

            <View style={{ gap: 8, marginVertical: 6 }}>
              {/* خيار 1: احتفاظ بالشعبة */}
              <TouchableOpacity
                data-testid="bulk-section-keep"
                onPress={() => setBulkSectionMode('keep')}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 10,
                  padding: 12, borderRadius: 10,
                  borderWidth: 1.5,
                  borderColor: bulkSectionMode === 'keep' ? '#2e7d32' : '#e0e0e0',
                  backgroundColor: bulkSectionMode === 'keep' ? '#e8f5e9' : '#fafafa',
                }}
              >
                <Ionicons
                  name={bulkSectionMode === 'keep' ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={bulkSectionMode === 'keep' ? '#2e7d32' : '#999'}
                />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#222', textAlign: 'right' }}>
                    احتفظ بالشعبة الحالية لكل طالب
                  </Text>
                  <Text style={{ fontSize: 10, color: '#666', textAlign: 'right' }}>
                    يبقى كل طالب في شعبته كما هي
                  </Text>
                </View>
              </TouchableOpacity>

              {/* خيار 2: شعبة موحّدة */}
              <TouchableOpacity
                data-testid="bulk-section-set"
                onPress={() => setBulkSectionMode('set')}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 10,
                  padding: 12, borderRadius: 10,
                  borderWidth: 1.5,
                  borderColor: bulkSectionMode === 'set' ? '#1976d2' : '#e0e0e0',
                  backgroundColor: bulkSectionMode === 'set' ? '#e3f2fd' : '#fafafa',
                }}
              >
                <Ionicons
                  name={bulkSectionMode === 'set' ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={bulkSectionMode === 'set' ? '#1976d2' : '#999'}
                />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#222', textAlign: 'right' }}>
                    اختر شعبة موحّدة لجميع الطلاب
                  </Text>
                  <Text style={{ fontSize: 10, color: '#666', textAlign: 'right' }}>
                    سيتم نقل الجميع إلى نفس الشعبة
                  </Text>
                </View>
              </TouchableOpacity>

              {/* مدخل/اقتراحات الشعبة الموحّدة */}
              {bulkSectionMode === 'set' && (
                <View style={{ padding: 8, backgroundColor: '#f5f5f5', borderRadius: 8 }}>
                  {(() => {
                    const suggestions = getSectionsAtLevel(selectedDeptFilter, pendingBulkLevel || '');
                    if (!suggestions.length) return null;
                    return (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                        <Text style={{ fontSize: 10, color: '#666', width: '100%', textAlign: 'right' }}>
                          الشعب الموجودة في م{pendingBulkLevel}:
                        </Text>
                        {suggestions.map(sec => (
                          <TouchableOpacity
                            key={sec}
                            data-testid={`bulk-section-suggest-${sec}`}
                            onPress={() => setBulkNewSection(sec)}
                            style={{
                              paddingHorizontal: 10,
                              paddingVertical: 4,
                              borderRadius: 12,
                              borderWidth: 1,
                              borderColor: bulkNewSection === sec ? '#1976d2' : '#bbdefb',
                              backgroundColor: bulkNewSection === sec ? '#1976d2' : '#e3f2fd',
                            }}
                          >
                            <Text style={{
                              fontSize: 11,
                              fontWeight: '700',
                              color: bulkNewSection === sec ? '#fff' : '#1976d2',
                            }}>
                              {sec}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    );
                  })()}
                  <TextInput
                    data-testid="bulk-section-input"
                    style={{
                      borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 6,
                      paddingHorizontal: 10, paddingVertical: 8, fontSize: 13,
                      textAlign: 'right', backgroundColor: '#fff',
                    }}
                    placeholder="اسم الشعبة (مثال: A أو ب)"
                    value={bulkNewSection}
                    onChangeText={setBulkNewSection}
                    placeholderTextColor="#aaa"
                  />
                </View>
              )}

              {/* خيار 3: بلا شعبة */}
              <TouchableOpacity
                data-testid="bulk-section-clear"
                onPress={() => setBulkSectionMode('clear')}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 10,
                  padding: 12, borderRadius: 10,
                  borderWidth: 1.5,
                  borderColor: bulkSectionMode === 'clear' ? '#c62828' : '#e0e0e0',
                  backgroundColor: bulkSectionMode === 'clear' ? '#ffebee' : '#fafafa',
                }}
              >
                <Ionicons
                  name={bulkSectionMode === 'clear' ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={bulkSectionMode === 'clear' ? '#c62828' : '#999'}
                />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#222', textAlign: 'right' }}>
                    بلا شعبة لجميع الطلاب
                  </Text>
                  <Text style={{ fontSize: 10, color: '#666', textAlign: 'right' }}>
                    سيتم حذف الشعبة من جميع الطلاب المحددين
                  </Text>
                </View>
              </TouchableOpacity>
            </View>

            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: '#f5f5f5', padding: 12, borderRadius: 10, alignItems: 'center' }}
                onPress={() => {
                  setShowBulkSectionModal(false);
                  setPendingBulkLevel(null);
                }}
                disabled={changingLevel}
              >
                <Text style={{ color: '#666', fontWeight: '700' }}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity
                data-testid="bulk-section-confirm"
                style={{ flex: 2, backgroundColor: '#9c27b0', padding: 12, borderRadius: 10, alignItems: 'center', opacity: changingLevel ? 0.6 : 1 }}
                onPress={submitBulkChangeLevel}
                disabled={changingLevel}
              >
                {changingLevel ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={{ color: '#fff', fontWeight: '800' }}>تأكيد التغيير</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      )}

      {/* نافذة تغيير الحالة (تخرج/إعادة/فصل/تجميد) */}
      {showStatusModal && (
      <Modal visible={showStatusModal} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 16 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 20, width: '95%', maxWidth: 440 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: '#ede7f6', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="shuffle" size={20} color="#5e35b1" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: '800', color: '#222', textAlign: 'right' }}>
                  تغيير حالة {selectedIds.size} طالب
                </Text>
                <Text style={{ fontSize: 11, color: '#888', textAlign: 'right' }}>
                  اختر الحالة الجديدة (مع خيار نقل المستوى)
                </Text>
              </View>
            </View>

            <Text style={{ fontSize: 12, color: '#555', fontWeight: '700', marginBottom: 6, textAlign: 'right' }}>الحالة الجديدة:</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {STATUS_OPTIONS.map(o => (
                <TouchableOpacity
                  key={o.value}
                  data-testid={`status-opt-${o.value}`}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 5,
                    paddingHorizontal: 12, paddingVertical: 9, borderRadius: 8,
                    borderWidth: 1.5,
                    borderColor: statusToApply === o.value ? o.color : '#e0e0e0',
                    backgroundColor: statusToApply === o.value ? o.color : '#fafafa',
                  }}
                  onPress={() => setStatusToApply(o.value)}
                >
                  <Ionicons name={o.icon} size={15} color={statusToApply === o.value ? '#fff' : o.color} />
                  <Text style={{ fontSize: 12, fontWeight: '700', color: statusToApply === o.value ? '#fff' : '#444' }}>
                    {o.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={{ fontSize: 12, color: '#555', fontWeight: '700', marginBottom: 4, textAlign: 'right' }}>
              المستوى الجديد (اختياري):
            </Text>
            <TextInput
              testID="status-new-level"
              style={{
                borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8,
                paddingHorizontal: 12, paddingVertical: 9, fontSize: 13,
                textAlign: 'right', marginBottom: 4,
              }}
              placeholder="اتركه فارغاً للإبقاء على المستوى الحالي"
              keyboardType="numeric"
              value={statusNewLevel}
              onChangeText={setStatusNewLevel}
              placeholderTextColor="#aaa"
            />
            {statusToApply === 'repeat' && (
              <Text style={{ fontSize: 10, color: '#5e35b1', marginBottom: 8, textAlign: 'right' }}>
                💡 الإعادة: اتركه فارغاً ليبقى بنفس المستوى، أو اكتب رقم للنزول
              </Text>
            )}

            <Text style={{ fontSize: 12, color: '#555', fontWeight: '700', marginBottom: 4, marginTop: 6, textAlign: 'right' }}>
              السبب / ملاحظة (اختياري):
            </Text>
            <TextInput
              testID="status-reason"
              style={{
                borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 8,
                paddingHorizontal: 12, paddingVertical: 9, fontSize: 13,
                textAlign: 'right', minHeight: 50,
              }}
              placeholder="مثال: رسوب في 3 مقررات"
              value={statusReason}
              onChangeText={setStatusReason}
              multiline
              placeholderTextColor="#aaa"
            />

            <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: '#f5f5f5', padding: 12, borderRadius: 10, alignItems: 'center' }}
                onPress={() => setShowStatusModal(false)}
              >
                <Text style={{ color: '#666', fontWeight: '700' }}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="apply-status-btn"
                style={{ flex: 1, backgroundColor: getStatusInfo(statusToApply).color, padding: 12, borderRadius: 10, alignItems: 'center' }}
                onPress={handleBulkChangeStatus}
                disabled={applyingStatus}
              >
                {applyingStatus ? <ActivityIndicator color="#fff" /> : (
                  <Text style={{ color: '#fff', fontWeight: '800' }}>تطبيق</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      )}

      {/* نافذة سجل تاريخ الحالة */}

      {/* 🆕 مودال إجراءات المقررات (نسخ/نقل/إلغاء تسجيل) */}
      {enrollActionMode && (
        <Modal visible={!!enrollActionMode} transparent animationType="fade" onRequestClose={() => setEnrollActionMode(null)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 16, width: '100%', maxWidth: 520, maxHeight: '85%' }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: '#1a2540', textAlign: 'right', marginBottom: 10 }}>
                {enrollActionMode === 'copy' ? '📋 نسخ إلى مقرر' : enrollActionMode === 'move' ? '🔀 نقل إلى مقرر' : '❌ إلغاء تسجيل من مقرر'}
              </Text>
              <Text style={{ fontSize: 12, color: '#556', textAlign: 'right', marginBottom: 8 }}>
                {selectedIds.size} طالب محدد
              </Text>

              {enrollActionMode === 'move' && (
                <>
                  <Text style={{ fontSize: 12, color: '#556', fontWeight: '600', textAlign: 'right', marginTop: 8 }}>المقرر المصدر (سيُحذف الطلاب منه):</Text>
                  <ScrollView style={{ maxHeight: 130, borderWidth: 1, borderColor: '#c0c8d4', borderRadius: 6, marginTop: 4 }}>
                    {enrollActionCourses.map(c => (
                      <TouchableOpacity
                        key={'src-' + c.id}
                        style={{ padding: 8, backgroundColor: enrollActionSourceId === c.id ? '#fff3d6' : '#fff', borderBottomWidth: 1, borderBottomColor: '#eef1f6' }}
                        onPress={() => setEnrollActionSourceId(c.id)}
                        data-testid={`src-course-${c.id}`}
                      >
                        <Text style={{ fontSize: 12, textAlign: 'right', color: enrollActionSourceId === c.id ? '#8a6d3b' : '#333' }}>
                          {enrollActionSourceId === c.id ? '● ' : '○ '}{c.name} ({c.code}) {c.section ? `- شعبة ${c.section}` : ''}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </>
              )}

              <Text style={{ fontSize: 12, color: '#556', fontWeight: '600', textAlign: 'right', marginTop: 10 }}>
                {enrollActionMode === 'unenroll' ? 'المقررات المراد إلغاء التسجيل منها:' : enrollActionMode === 'move' ? 'المقرر الهدف:' : 'المقررات الهدف (يمكن اختيار عدة):'}
              </Text>
              <TextInput
                style={{ borderWidth: 1, borderColor: '#c0c8d4', borderRadius: 6, padding: 6, marginTop: 4, fontSize: 12 }}
                placeholder="بحث بالاسم أو الكود..."
                value={enrollActionSearch}
                onChangeText={setEnrollActionSearch}
                textAlign="right"
                data-testid="enroll-action-search"
              />
              <ScrollView style={{ maxHeight: 200, borderWidth: 1, borderColor: '#c0c8d4', borderRadius: 6, marginTop: 4 }}>
                {enrollActionCourses
                  .filter(c => !enrollActionSearch || (c.name || '').includes(enrollActionSearch) || (c.code || '').toLowerCase().includes(enrollActionSearch.toLowerCase()))
                  .map(c => {
                    const isSelected = enrollActionTargetIds.includes(c.id);
                    const isSingle = enrollActionMode === 'move';
                    return (
                      <TouchableOpacity
                        key={c.id}
                        style={{ padding: 8, backgroundColor: isSelected ? '#e3f2fd' : '#fff', borderBottomWidth: 1, borderBottomColor: '#eef1f6' }}
                        onPress={() => {
                          if (isSingle) setEnrollActionTargetIds([c.id]);
                          else toggleEnrollActionTarget(c.id);
                        }}
                        data-testid={`target-course-${c.id}`}
                      >
                        <Text style={{ fontSize: 12, textAlign: 'right', color: isSelected ? '#1565c0' : '#333' }}>
                          {isSelected ? '✓ ' : '○ '}{c.name} ({c.code}) {c.section ? `- شعبة ${c.section}` : ''}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
              </ScrollView>

              <View style={{ flexDirection: 'row-reverse', gap: 8, marginTop: 14 }}>
                <TouchableOpacity
                  style={{ flex: 1, backgroundColor: enrollActionMode === 'unenroll' ? '#c62828' : enrollActionMode === 'move' ? '#f57c00' : '#1565c0', padding: 10, borderRadius: 6, alignItems: 'center' }}
                  onPress={submitEnrollAction}
                  disabled={enrollActionLoading}
                  data-testid="confirm-enroll-action"
                >
                  {enrollActionLoading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>تنفيذ</Text>}
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ flex: 1, backgroundColor: '#8a95a8', padding: 10, borderRadius: 6, alignItems: 'center' }}
                  onPress={() => setEnrollActionMode(null)}
                >
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>إلغاء</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}


      {showHistoryModal && (
      <Modal visible={showHistoryModal} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 16 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 18, width: '95%', maxWidth: 480 }}>
            <Text style={{ fontSize: 15, fontWeight: '800', color: '#222', marginBottom: 4, textAlign: 'right' }}>
              سجل تغييرات الحالة
            </Text>
            <Text style={{ fontSize: 11, color: '#888', marginBottom: 12, textAlign: 'right' }}>
              {historyFor?.full_name}
            </Text>
            {historyData.length === 0 ? (
              <Text style={{ textAlign: 'center', color: '#aaa', padding: 20, fontSize: 12 }}>
                لا يوجد سجل تغيير حالة سابق
              </Text>
            ) : (
              <ScrollView style={{ maxHeight: 360 }}>
                {historyData.map((h: any, i: number) => {
                  const o = getStatusInfo(h.old_status);
                  const n = getStatusInfo(h.new_status);
                  return (
                    <View key={i} style={{
                      backgroundColor: '#fafafa', padding: 10, borderRadius: 8, marginBottom: 6,
                      borderRightWidth: 3, borderRightColor: n.color,
                    }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10, backgroundColor: o.bg }}>
                          <Text style={{ fontSize: 10, fontWeight: '700', color: o.color }}>{o.label}</Text>
                        </View>
                        <Ionicons name="arrow-back" size={12} color="#888" />
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10, backgroundColor: n.bg }}>
                          <Text style={{ fontSize: 10, fontWeight: '700', color: n.color }}>{n.label}</Text>
                        </View>
                        {h.old_level !== h.new_level && (
                          <Text style={{ fontSize: 11, color: '#666', fontWeight: '700' }}>
                            م{h.old_level} → م{h.new_level}
                          </Text>
                        )}
                      </View>
                      {h.reason ? (
                        <Text style={{ fontSize: 11, color: '#555', marginTop: 5, textAlign: 'right' }}>
                          📝 {h.reason}
                        </Text>
                      ) : null}
                      <Text style={{ fontSize: 9, color: '#999', marginTop: 4, textAlign: 'right' }}>
                        {h.changed_by_username || '—'} • {new Date(h.created_at || h.effective_date).toLocaleString('ar-EG')}
                      </Text>
                    </View>
                  );
                })}
              </ScrollView>
            )}
            <TouchableOpacity
              style={{ backgroundColor: '#f5f5f5', padding: 12, borderRadius: 10, alignItems: 'center', marginTop: 10 }}
              onPress={() => setShowHistoryModal(false)}
            >
              <Text style={{ color: '#666', fontWeight: '700' }}>إغلاق</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      )}

      {/* نافذة الحذف الآمن للطالب */}
      {showSafeDeleteModal && (
      <Modal visible={showSafeDeleteModal} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 24, width: '90%', maxWidth: 420 }}>
            <Ionicons name="warning" size={40} color="#f44336" style={{ alignSelf: 'center', marginBottom: 12 }} />
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#333', textAlign: 'center', marginBottom: 8 }}>
              حذف الطالب
            </Text>
            <Text style={{ fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 16 }}>
              "{deleteTarget?.full_name || ''}"
            </Text>
            
            {deleteInfo && !deleteInfo.error ? (
              <View style={{ backgroundColor: '#fff3e0', padding: 14, borderRadius: 10, marginBottom: 16 }}>
                <Text style={{ fontSize: 13, color: '#e65100', fontWeight: '600', marginBottom: 8, textAlign: 'center' }}>
                  سيتم حذف التالي نهائياً:
                </Text>
                <Text style={{ fontSize: 13, color: '#555', lineHeight: 24 }}>
                  {`• ${deleteInfo.courses_count} مقرر مسجل${deleteInfo.courses_names?.length ? ` (${deleteInfo.courses_names.join('، ')})` : ''}\n• ${deleteInfo.attendance_count} سجل حضور${deleteInfo.has_user_account ? '\n• حساب المستخدم سيتم حذفه' : ''}`}
                </Text>
              </View>
            ) : deleteInfo?.error ? (
              <Text style={{ color: '#f44336', textAlign: 'center', marginBottom: 12 }}>فشل في جلب المعلومات</Text>
            ) : (
              <ActivityIndicator size="small" color="#1565c0" style={{ marginBottom: 16 }} />
            )}
            
            <View style={{ backgroundColor: '#e8f5e9', padding: 12, borderRadius: 8, marginBottom: 16 }}>
              <Text style={{ fontSize: 12, color: '#2e7d32', textAlign: 'center' }}>
                سيتم تنزيل نسخة احتياطية (JSON) تلقائياً قبل الحذف
              </Text>
            </View>
            
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: '#f5f5f5', padding: 14, borderRadius: 10, alignItems: 'center' }}
                onPress={() => { setShowSafeDeleteModal(false); setDeleteTarget(null); }}
                data-testid="cancel-delete-student-btn"
              >
                <Text style={{ color: '#666', fontWeight: '600' }}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: '#f44336', padding: 14, borderRadius: 10, alignItems: 'center', opacity: (deletingStudent || !deleteInfo || deleteInfo.error) ? 0.6 : 1 }}
                onPress={confirmSafeDeleteStudent}
                disabled={deletingStudent || !deleteInfo || deleteInfo.error}
                data-testid="confirm-delete-student-btn"
              >
                {deletingStudent ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={{ color: '#fff', fontWeight: '700' }}>حذف نهائي</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      )}

      {/* 🆕 ============ مودال التخريج الجماعي ============ */}
      <Modal
        visible={showBulkGraduateModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowBulkGraduateModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxWidth: 540, maxHeight: '90%' }]}>
            {/* الرأس */}
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
                <Ionicons name="school" size={20} color="#0d47a1" />
                <Text style={styles.modalTitle}>تخريج جماعي</Text>
              </View>
              <TouchableOpacity onPress={() => setShowBulkGraduateModal(false)} testID="close-bulk-grad" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={22} color="#666" />
              </TouchableOpacity>
            </View>

            {/* الجسم — قابل للتمرير */}
            <ScrollView
              style={{ flexGrow: 0 }}
              contentContainerStyle={{ paddingHorizontal: 18, paddingVertical: 14, gap: 12 }}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.bulkInfoBox}>
                <Text style={styles.bulkInfoTitle}>
                  سيتم تخريج {selectedIds.size} طالب وإسناد سنة التخرج المختارة لجميعهم.
                </Text>
                <Text style={styles.bulkInfoSub}>
                  المعدل ورقم الشهادة يُضاف لكل طالب لاحقاً من تفاصيله.
                </Text>
              </View>

              {/* سنة التخرج */}
              <View>
                <Text style={styles.fieldLabel}>سنة التخرج <Text style={{ color: '#c62828' }}>*</Text></Text>
                <TextInput
                  style={styles.fieldInput}
                  placeholder="2025"
                  placeholderTextColor="#a8b1c2"
                  value={bulkGradYear}
                  onChangeText={(v) => setBulkGradYear(v.replace(/[^0-9]/g, '').slice(0, 4))}
                  keyboardType="numeric"
                  maxLength={4}
                  testID="bulk-grad-year"
                />
              </View>

              {/* الفصل */}
              <View>
                <Text style={styles.fieldLabel}>الفصل الذي تخرّجوا فيه</Text>
                <View style={{ flexDirection: 'row-reverse', gap: 8 }}>
                  {[
                    { v: 'first', label: 'الفصل الأول' },
                    { v: 'second', label: 'الفصل الثاني' },
                    { v: 'summer', label: 'الفصل الصيفي' },
                  ].map(s => {
                    const active = bulkGradSemester === s.v;
                    return (
                      <TouchableOpacity
                        key={s.v}
                        onPress={() => setBulkGradSemester(s.v)}
                        style={[styles.segBtn, active && styles.segBtnActive]}
                        testID={`bulk-grad-sem-${s.v}`}
                      >
                        <Text style={[styles.segBtnText, active && styles.segBtnTextActive]}>{s.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* تاريخ + تقدير في صف واحد */}
              <View style={{ flexDirection: 'row-reverse', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>تاريخ التخرج <Text style={styles.optionalTag}>(اختياري)</Text></Text>
                  <TextInput
                    style={styles.fieldInput}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#a8b1c2"
                    value={bulkGradDate}
                    onChangeText={setBulkGradDate}
                    testID="bulk-grad-date"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>التقدير <Text style={styles.optionalTag}>(اختياري)</Text></Text>
                  <TextInput
                    style={styles.fieldInput}
                    placeholder="ممتاز / جيد جداً"
                    placeholderTextColor="#a8b1c2"
                    value={bulkGradHonors}
                    onChangeText={setBulkGradHonors}
                    testID="bulk-grad-honors"
                  />
                </View>
              </View>

              {/* ملاحظات */}
              <View>
                <Text style={styles.fieldLabel}>ملاحظات <Text style={styles.optionalTag}>(اختياري)</Text></Text>
                <TextInput
                  style={[styles.fieldInput, { minHeight: 80, textAlignVertical: 'top', paddingTop: 10 }]}
                  placeholder="ملاحظات إضافية..."
                  placeholderTextColor="#a8b1c2"
                  value={bulkGradNotes}
                  onChangeText={setBulkGradNotes}
                  multiline
                  numberOfLines={3}
                  testID="bulk-grad-notes"
                />
              </View>
            </ScrollView>

            {/* الذيل — أزرار ثابتة */}
            <View style={styles.modalActionsFooter}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowBulkGraduateModal(false)}
                testID="bulk-grad-cancel"
                disabled={bulkGraduating}
              >
                <Text style={styles.modalCancelBtnText}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirmBtn, bulkGraduating && { opacity: 0.6 }]}
                onPress={handleBulkGraduate}
                disabled={bulkGraduating}
                testID="bulk-grad-confirm"
              >
                {bulkGraduating ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="school" size={16} color="#fff" />
                    <Text style={styles.modalConfirmBtnText}>تخريج {selectedIds.size} طالب</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 🔄 ============ مودال النقل الجماعي ============ */}
      <Modal
        visible={showBulkTransferModal}
        animationType="fade"
        transparent
        onRequestClose={() => setShowBulkTransferModal(false)}
      >
        <View style={styles.btModalOverlay}>
          <View style={styles.btModalCard}>
            {/* Header مع gradient */}
            <View style={styles.btHeader}>
              <View style={styles.btHeaderIconBox}>
                <Ionicons name="swap-horizontal" size={22} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.btHeaderTitle}>نقل جماعي للطلاب</Text>
                <Text style={styles.btHeaderSub}>{selectedIds.size} طالب محدد للنقل</Text>
              </View>
              <TouchableOpacity onPress={() => setShowBulkTransferModal(false)} style={styles.btHeaderClose} testID="close-bulk-transfer">
                <Ionicons name="close" size={20} color="#fff" />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={{ flexShrink: 1 }}
              contentContainerStyle={{ padding: 18, gap: 14 }}
              showsVerticalScrollIndicator
            >
              {/* بطاقة معلومات: مايحدث عند النقل */}
              <View style={styles.btInfoCard}>
                <View style={styles.btInfoIcon}>
                  <Ionicons name="information-circle" size={18} color="#fff" />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.btInfoTitle}>ماذا يحدث عند تنفيذ النقل؟</Text>
                  <Text style={styles.btInfoLine}>•  يُلغى تسجيل المقررات للفصل النشط تلقائياً</Text>
                  <Text style={styles.btInfoLine}>•  يُحفظ سجل نقل دائم لكل طالب (للمراجعة)</Text>
                  <Text style={styles.btInfoLine}>•  الطلاب بنفس البيانات الحالية سيُتخطّون</Text>
                </View>
              </View>

              {/* القسم: الوجهة الجديدة */}
              <View style={styles.btSection}>
                <View style={styles.btSectionHeader}>
                  <View style={[styles.btSectionDot, { backgroundColor: '#1565c0' }]} />
                  <Ionicons name="navigate" size={15} color="#1565c0" />
                  <Text style={styles.btSectionTitle}>الوجهة الجديدة</Text>
                </View>

                <View style={styles.btField}>
                  <Text style={styles.btLabel}>الكلية</Text>
                  <View style={styles.btPickerWrap}>
                    <Picker
                      selectedValue={bulkTrgFacId}
                      onValueChange={(v) => { setBulkTrgFacId(v); setBulkTrgDeptId(''); }}
                      style={styles.btPicker as any}
                    >
                      <Picker.Item label="— اختر الكلية —" value="" />
                      {bulkTrgFacs.map((f: any) => <Picker.Item key={f.id} label={f.name} value={f.id} />)}
                    </Picker>
                    <Ionicons name="chevron-down" size={14} color="#90a4ae" style={styles.btPickerChevron} />
                  </View>
                </View>

                <View style={styles.btField}>
                  <Text style={styles.btLabel}>القسم</Text>
                  <View style={[styles.btPickerWrap, !bulkTrgFacId && styles.btPickerDisabled]}>
                    <Picker
                      selectedValue={bulkTrgDeptId}
                      onValueChange={setBulkTrgDeptId}
                      enabled={!!bulkTrgFacId}
                      style={styles.btPicker as any}
                    >
                      <Picker.Item label={bulkTrgFacId ? '— اختر القسم —' : '— يلزم اختيار الكلية أولاً —'} value="" />
                      {departments
                        .filter((d: any) => !bulkTrgFacId || d.faculty_id === bulkTrgFacId)
                        .map((d: any) => <Picker.Item key={d.id} label={d.name} value={d.id} />)}
                    </Picker>
                    <Ionicons name="chevron-down" size={14} color="#90a4ae" style={styles.btPickerChevron} />
                  </View>
                </View>
              </View>

              {/* القسم: تفاصيل التسجيل */}
              <View style={styles.btSection}>
                <View style={styles.btSectionHeader}>
                  <View style={[styles.btSectionDot, { backgroundColor: '#6a1b9a' }]} />
                  <Ionicons name="layers" size={15} color="#6a1b9a" />
                  <Text style={styles.btSectionTitle}>تفاصيل التسجيل</Text>
                </View>
                <View style={{ flexDirection: 'row-reverse', gap: 10 }}>
                  <View style={[styles.btField, { flex: 1 }]}>
                    <Text style={styles.btLabel}>المستوى</Text>
                    <View style={styles.btPickerWrap}>
                      <Picker selectedValue={bulkTrgLevel} onValueChange={setBulkTrgLevel} style={styles.btPicker as any}>
                        {[1,2,3,4,5,6,7,8].map(n => <Picker.Item key={n} label={`المستوى ${n}`} value={String(n)} />)}
                      </Picker>
                      <Ionicons name="chevron-down" size={14} color="#90a4ae" style={styles.btPickerChevron} />
                    </View>
                  </View>
                  <View style={[styles.btField, { flex: 1 }]}>
                    <Text style={styles.btLabel}>الشعبة</Text>
                    <TextInput
                      value={bulkTrgSection}
                      onChangeText={setBulkTrgSection}
                      placeholder="مثال: أ"
                      placeholderTextColor="#b0bec5"
                      style={styles.btInput}
                      testID="bulk-transfer-section-input"
                    />
                  </View>
                </View>
              </View>

              {/* القسم: السبب */}
              <View style={styles.btSection}>
                <View style={styles.btSectionHeader}>
                  <View style={[styles.btSectionDot, { backgroundColor: '#37474f' }]} />
                  <Ionicons name="chatbox-ellipses" size={15} color="#37474f" />
                  <Text style={styles.btSectionTitle}>سبب النقل <Text style={styles.btOptional}>(اختياري)</Text></Text>
                </View>
                <TextInput
                  value={bulkTrgReason}
                  onChangeText={setBulkTrgReason}
                  placeholder="إعادة توزيع الشعب، طلب الطلاب، ترقية مستوى..."
                  placeholderTextColor="#b0bec5"
                  multiline
                  style={[styles.btInput, { minHeight: 72, textAlignVertical: 'top', paddingTop: 11 }]}
                  testID="bulk-transfer-reason-input"
                />
              </View>
            </ScrollView>

            {/* Footer */}
            <View style={styles.btFooter}>
              <TouchableOpacity
                style={styles.btCancelBtn}
                onPress={() => setShowBulkTransferModal(false)}
                disabled={bulkTransferring}
              >
                <Text style={styles.btCancelText}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btConfirmBtn, bulkTransferring && { opacity: 0.6 }]}
                onPress={handleBulkTransfer}
                disabled={bulkTransferring}
                testID="bulk-transfer-confirm"
              >
                {bulkTransferring ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="swap-horizontal" size={17} color="#fff" />
                    <Text style={styles.btConfirmText}>تأكيد نقل {selectedIds.size} طالب</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f4f6fb',
  },
  pageScroll: {
    padding: 20,
    paddingBottom: 60,
    maxWidth: 1440,
    width: '100%',
    alignSelf: 'center',
  },

  // ====== رأس الصفحة ======
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 18,
    flexWrap: 'wrap',
    gap: 12,
  },
  pageHeaderRight: {
    alignItems: 'flex-end',
  },
  pageTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: '#1a2540',
    textAlign: 'right',
    marginBottom: 6,
  },
  breadcrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  breadcrumbLink: {
    fontSize: 13,
    color: '#2962ff',
    fontWeight: '500',
  },
  breadcrumbCurrent: {
    fontSize: 13,
    color: '#8a95a8',
    fontWeight: '500',
  },
  pageHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  btnPrimary: {
    backgroundColor: '#2962ff',
  },
  btnPrimaryText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  btnSuccess: {
    backgroundColor: '#22c55e',
  },
  btnGhost: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e3e7ee',
  },
  btnGhostText: {
    color: '#1a2540',
    fontSize: 13,
    fontWeight: '600',
  },

  // ====== بطاقات الإحصائيات ======
  statsGrid: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 18,
    flexWrap: 'wrap',
  },
  statCard: {
    flex: 1,
    minWidth: 200,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 18,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    borderColor: '#eef1f6',
  },
  statIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statTextCol: {
    flex: 1,
    alignItems: 'flex-end',
  },
  statLabel: {
    fontSize: 13,
    color: '#8a95a8',
    fontWeight: '500',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 22,
    color: '#1a2540',
    fontWeight: '700',
    marginBottom: 2,
  },
  statSubLabel: {
    fontSize: 11,
    color: '#a8b1c2',
  },

  // ====== بطاقة الفلاتر ======
  filterCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 18,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#eef1f6',
  },
  filterRow: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-end',
    gap: 12,
    flexWrap: 'wrap',
  },
  filterField: {
    flex: 1,
    minWidth: 140,
  },
  filterLbl: {
    fontSize: 12,
    color: '#5b6678',
    fontWeight: '500',
    marginBottom: 5,
    textAlign: 'right',
  },
  searchBox: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#e3e7ee',
    height: 40,
  },
  searchBoxInput: {
    flex: 1,
    fontSize: 13,
    color: '#1a2540',
    textAlign: 'right',
    outlineStyle: 'none' as any,
  },
  dropdown: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e3e7ee',
    height: 40,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  dropdownInner: {
    height: 40,
    fontSize: 13,
    color: '#1a2540',
    textAlign: 'right',
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  filterBtns: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 14,
  },
  resetBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 9,
    paddingHorizontal: 4,
  },
  resetBtnText: {
    fontSize: 13,
    color: '#2962ff',
    fontWeight: '600',
  },

  // ====== شريط التحديد ======
  selBar: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#eef4ff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#cfdcff',
    flexWrap: 'wrap',
  },
  selBarItem: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  selBarText: { fontSize: 13, color: '#2962ff', fontWeight: '600' },
  selBarCount: { fontSize: 12, color: '#1a2540', fontWeight: '600' },
  selActionBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 7,
  },
  selActionText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  selCancelText: { fontSize: 13, color: '#5b6678', fontWeight: '600', marginRight: 8 },

  // ====== بطاقة الجدول ======
  tableCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#eef1f6',
  },
  tableCardHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eef1f6',
  },
  tableCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1a2540',
  },
  tableCardCount: {
    fontSize: 12,
    color: '#5b6678',
  },
  tableCardCountAccent: {
    color: '#2962ff',
    fontWeight: '700',
  },
  selectModeBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: '#eef4ff',
  },
  selectModeText: { fontSize: 12, color: '#2962ff', fontWeight: '600' },
  tableHeaderRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: '#fafbfd',
    borderBottomWidth: 1,
    borderBottomColor: '#eef1f6',
    minHeight: 44,
  },
  thText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#5b6678',
    textAlign: 'right',
  },
  tableRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#f3f5f9',
    minHeight: 56,
  },
  tableRowAlt: {
    backgroundColor: '#fcfcfd',
  },
  tableRowSelected: {
    backgroundColor: '#eef4ff',
  },
  cellPad: {
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  // عرض الأعمدة (flex بدلاً من قيم ثابتة)
  colStudent: { flex: 2.2, flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  colUniId: { flex: 1.3 },
  colInner: { flex: 1 },
  colProg: { flex: 1.2 },
  colLevel: { flex: 0.8 },
  colStatus: { flex: 1 },
  colDate: { flex: 1.1 },
  colActions: { flex: 0.7, alignItems: 'flex-start', position: 'relative' },

  avatarCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#dfe6ef',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowCheckbox: { width: 32, alignItems: 'center', justifyContent: 'center' },
  studentNameCell: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1a2540',
    flex: 1,
    textAlign: 'right',
  },
  // 🆕 شارة الإشعارات غير المقروءة (بجانب اسم الطالب)
  unreadNotifBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#d84315',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 6,
  },
  unreadNotifBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  uniIdBadge: {
    alignSelf: 'flex-end',
    backgroundColor: '#e7f6ee',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  uniIdBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#22a35a',
    letterSpacing: 0.3,
  },
  innerIdText: { fontSize: 13, color: '#5b6678', textAlign: 'right' },
  progCell: { fontSize: 13, color: '#1a2540', textAlign: 'right' },
  levelCell: { fontSize: 13, color: '#1a2540', textAlign: 'right', fontWeight: '600' },
  mutedCell: { fontSize: 12, color: '#a8b1c2', textAlign: 'right' },
  dateCell: { fontSize: 12, color: '#5b6678', textAlign: 'right' },
  statusPill: {
    alignSelf: 'flex-end',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  statusPillText: { fontSize: 11, fontWeight: '700' },

  dotsBtn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e3e7ee',
    backgroundColor: '#fff',
  },
  menuBackdrop: {
    position: 'absolute',
    top: -1000,
    left: -1000,
    right: -1000,
    bottom: -1000,
    backgroundColor: 'transparent',
    zIndex: 1,
  },
  actionMenu: {
    position: 'absolute',
    top: 38,
    left: 10,
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingVertical: 6,
    minWidth: 200,
    borderWidth: 1,
    borderColor: '#e3e7ee',
    zIndex: 10,
    boxShadow: '0 4px 16px rgba(20,30,55,0.08)' as any,
  },
  menuItem: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  menuItemDanger: {
    borderTopWidth: 1,
    borderTopColor: '#f3f5f9',
    marginTop: 2,
  },
  menuText: { fontSize: 13, color: '#1a2540', fontWeight: '500', textAlign: 'right' },

  menuModalBackdrop: {
    position: 'fixed' as any,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(20,30,55,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    zIndex: 9999,
  },
  menuModalCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    width: '100%',
    maxWidth: 380,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#eef1f6',
    boxShadow: '0 12px 32px rgba(20,30,55,0.18)' as any,
  },
  menuModalHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f5f9',
    marginBottom: 4,
  },
  menuModalTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1a2540',
    flex: 1,
    textAlign: 'right',
  },

  tableEmpty: {
    paddingVertical: 60,
    alignItems: 'center',
    gap: 12,
  },
  tableEmptyText: {
    fontSize: 14,
    color: '#8a95a8',
  },

  tableFooter: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderTopWidth: 1,
    borderTopColor: '#eef1f6',
    flexWrap: 'wrap',
    gap: 12,
  },
  perPageWrap: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  perPageLbl: { fontSize: 12, color: '#5b6678' },
  perPageBox: {
    width: 70,
    height: 34,
    borderWidth: 1,
    borderColor: '#e3e7ee',
    borderRadius: 6,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  perPagePicker: {
    height: 34,
    fontSize: 12,
    borderWidth: 0,
    backgroundColor: 'transparent',
  },
  pagerWrap: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
  },
  pagerBtn: {
    minWidth: 32,
    height: 32,
    borderRadius: 6,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e3e7ee',
    backgroundColor: '#fff',
  },
  pagerBtnActive: {
    backgroundColor: '#2962ff',
    borderColor: '#2962ff',
  },
  pagerBtnText: { fontSize: 12, color: '#1a2540', fontWeight: '600' },
  pagerBtnTextActive: { color: '#fff' },
  pagerDots: { color: '#8a95a8', paddingHorizontal: 4 },
  pagerNavBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e3e7ee',
    backgroundColor: '#fff',
  },
  pagerNavBtnDisabled: { backgroundColor: '#fafbfd' },
  pagerNavText: { fontSize: 12, color: '#1a2540', fontWeight: '600' },

  // ====== استبقاء الستايلات القديمة المستخدمة في الـ modals ======
  // Compact bar — old (kept to avoid breaking refs)
  compactBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    flexWrap: 'wrap',
  },
  searchSlim: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flex: 1,
    minWidth: 150,
    height: 36,
  },
  searchSlimInput: { flex: 1, fontSize: 13, color: '#333', textAlign: 'right' },
  compactSelect: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    overflow: 'hidden',
    flex: 0.7,
    minWidth: 100,
    height: 36,
    justifyContent: 'center',
  },
  pickerSlim: { height: 36, fontSize: 12 },
  compactSection: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    paddingHorizontal: 10,
    height: 36,
    fontSize: 13,
    color: '#333',
    textAlign: 'center',
    width: 70,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  iconBtnBadge: {
    position: 'absolute',
    top: -4,
    left: -4,
    backgroundColor: '#fff',
    color: '#9c27b0',
    fontSize: 10,
    fontWeight: '700',
    borderRadius: 8,
    paddingHorizontal: 4,
    minWidth: 16,
    textAlign: 'center',
    overflow: 'hidden',
  },
  iconBtnDot: {
    position: 'absolute',
    top: 4,
    left: 4,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#fff',
  },
  contextBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 5,
    backgroundColor: '#e3f2fd',
  },
  contextText: { flex: 1, fontSize: 11, color: '#1565c0', textAlign: 'right' },
  clearLink: { fontSize: 11, color: '#1565c0', fontWeight: '700', textDecorationLine: 'underline' },
  header: {
    backgroundColor: '#1565c0',
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backBtn: {
    padding: 8,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    fontSize: 16,
    textAlign: 'right',
  },
  filtersRow: {
    flexDirection: 'row',
    marginBottom: 12,
    gap: 8,
  },
  filterItem: {
    flex: 1,
  },
  filterLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
    textAlign: 'right',
  },
  pickerContainer: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    overflow: 'hidden',
  },
  picker: {
    height: 45,
  },
  sectionInput: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    paddingHorizontal: 12,
    paddingVertical: 12,
    textAlign: 'right',
  },
  selectionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e3f2fd',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    gap: 12,
  },
  selectAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  selectAllText: {
    color: '#1565c0',
    fontSize: 14,
  },
  selectedCount: {
    flex: 1,
    textAlign: 'center',
    color: '#333',
  },
  cancelSelectionBtn: {
    padding: 8,
  },
  cancelSelectionText: {
    color: '#666',
  },
  bulkDeleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f44336',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    gap: 4,
  },
  bulkDeleteText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  countContainer: {
    backgroundColor: '#e3f2fd',
    padding: 8,
    borderRadius: 6,
    marginBottom: 12,
  },
  countText: {
    color: '#1565c0',
    textAlign: 'center',
    fontWeight: '500',
  },
  listContainer: {
    paddingBottom: 20,
  },
  itemCard: {
    backgroundColor: '#fff',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e8e8e8',
  },
  itemCardSelected: {
    borderColor: '#1565c0',
    backgroundColor: '#e3f2fd',
  },
  checkbox: {
    marginLeft: 6,
  },
  itemInfo: {
    flex: 1,
    gap: 2,
  },
  itemTopRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: 6,
  },
  itemBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  itemName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#222',
    textAlign: 'right',
  },
  itemMutedSm: {
    fontSize: 11,
    color: '#777',
  },
  itemDetail: {
    fontSize: 11,
    color: '#777',
    textAlign: 'right',
  },
  refBadge: {
    fontSize: 11,
    color: '#2e7d32',
    fontWeight: '700',
    backgroundColor: '#e8f5e9',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    letterSpacing: 0.3,
  },
  statusInlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    marginRight: 4,
  },
  statusInlineBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  courseChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 3,
  },
  courseChip: {
    backgroundColor: '#e3f2fd',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  courseChipText: {
    fontSize: 10,
    color: '#1565c0',
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  accountBtn: {
    padding: 8,
    borderRadius: 6,
  },
  accountBtnActive: {
    backgroundColor: '#4caf50',
  },
  accountBtnInactive: {
    backgroundColor: '#9e9e9e',
  },
  keyBtn: {
    padding: 8,
    borderRadius: 6,
    backgroundColor: '#fff3e0',
  },
  viewBtn: {
    padding: 8,
    borderRadius: 6,
    backgroundColor: '#e3f2fd',
  },
  editBtn: {
    padding: 8,
    borderRadius: 6,
    backgroundColor: '#e8f5e9',
  },
  deleteBtn: {
    padding: 8,
    borderRadius: 6,
    backgroundColor: '#ffebee',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 18,
    color: '#999',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#bbb',
    marginTop: 8,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 12,
    width: '90%',
    maxWidth: 500,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  // ====== مودال التخريج الجماعي — تنسيقات منظّمة ======
  bulkInfoBox: {
    backgroundColor: '#e3f2fd',
    padding: 12,
    borderRadius: 10,
    borderRightWidth: 3,
    borderRightColor: '#1565c0',
  },
  bulkInfoTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0d47a1',
    textAlign: 'right',
    lineHeight: 20,
  },
  bulkInfoSub: {
    fontSize: 11,
    color: '#5b6678',
    textAlign: 'right',
    marginTop: 4,
    lineHeight: 18,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1a2540',
    marginBottom: 6,
    textAlign: 'right',
  },
  optionalTag: {
    fontSize: 11,
    fontWeight: '400',
    color: '#8a95a8',
  },
  fieldInput: {
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#1a2540',
    textAlign: 'right',
    borderWidth: 1,
    borderColor: '#d6dde6',
  },
  segBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#d6dde6',
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  segBtnActive: {
    borderColor: '#0d47a1',
    backgroundColor: '#0d47a1',
  },
  segBtnText: {
    color: '#5b6678',
    fontSize: 12.5,
    fontWeight: '700',
  },
  segBtnTextActive: {
    color: '#fff',
  },
  modalActionsFooter: {
    flexDirection: 'row-reverse',
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#e7ebf1',
    backgroundColor: '#fafbfd',
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
  },
  modalConfirmBtn: {
    flex: 1,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#0d47a1',
  },
  modalConfirmBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  modalCancelBtn: {
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d6dde6',
  },
  modalCancelBtnText: {
    color: '#5b6678',
    fontWeight: '700',
    fontSize: 14,
  },
  modalBody: {
    padding: 16,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  detailLabel: {
    color: '#666',
    fontSize: 14,
  },
  detailValue: {
    color: '#333',
    fontSize: 14,
    fontWeight: '500',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 20,
    marginBottom: 12,
    textAlign: 'right',
  },
  attendanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  attendanceDate: {
    color: '#666',
    fontSize: 14,
  },
  attendanceStatus: {
    fontSize: 14,
    fontWeight: '500',
  },
  noAttendance: {
    color: '#999',
    textAlign: 'center',
    paddingVertical: 20,
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    color: '#333',
    marginBottom: 6,
    textAlign: 'right',
  },
  input: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    textAlign: 'right',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  saveBtn: {
    backgroundColor: '#1565c0',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  saveBtnDisabled: {
    backgroundColor: '#90caf9',
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  // styles for warning button and modal
  warningBtn: {
    padding: 8,
    borderRadius: 6,
    backgroundColor: '#fff3e0',
  },
  warningStudentInfo: {
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    marginBottom: 16,
  },
  warningStudentName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 8,
  },
  warningStudentId: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  warningTypeContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  warningTypeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#f57c00',
    gap: 8,
  },
  warningTypeBtnActive: {
    backgroundColor: '#f57c00',
    borderColor: '#f57c00',
  },
  warningTypeBtnActiveBlue: {
    backgroundColor: '#1976d2',
    borderColor: '#1976d2',
  },
  warningTypeText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  warningTypeTextActive: {
    color: '#fff',
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  sendWarningBtn: {
    backgroundColor: '#f57c00',
    padding: 14,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    gap: 8,
  },
  sendWarningBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },

  /* 🔄 ============ Bulk Transfer Modal — visual design ============ */
  btModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.62)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  btModalCard: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '90%',
    backgroundColor: '#f8fafc',
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 12,
  },
  btHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
    paddingHorizontal: 18,
    backgroundColor: '#e65100',
  },
  btHeaderIconBox: {
    width: 42, height: 42, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.20)',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
  },
  btHeaderTitle: { fontSize: 17, fontWeight: '800', color: '#fff', textAlign: 'right' },
  btHeaderSub: { fontSize: 12, color: 'rgba(255,255,255,0.85)', textAlign: 'right', marginTop: 2 },
  btHeaderClose: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center', alignItems: 'center',
  },

  /* Info card */
  btInfoCard: {
    flexDirection: 'row-reverse',
    gap: 10,
    backgroundColor: '#fff8e1',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#ffe0b2',
  },
  btInfoIcon: {
    width: 30, height: 30, borderRadius: 8,
    backgroundColor: '#e65100',
    justifyContent: 'center', alignItems: 'center',
  },
  btInfoTitle: { fontSize: 13, fontWeight: '800', color: '#5d4037', textAlign: 'right' },
  btInfoLine: { fontSize: 11, color: '#795548', textAlign: 'right', lineHeight: 18 },

  /* Section card */
  btSection: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#eceff1',
    shadowColor: '#94a3b8',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  btSectionHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  btSectionDot: { width: 4, height: 18, borderRadius: 2 },
  btSectionTitle: { fontSize: 14, fontWeight: '800', color: '#0f172a', flex: 1, textAlign: 'right' },
  btOptional: { fontSize: 11, color: '#94a3b8', fontWeight: '500' },
  btField: { marginBottom: 10 },
  btLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    textAlign: 'right',
    marginBottom: 6,
    marginRight: 2,
  },

  /* Pickers & inputs */
  btPickerWrap: {
    position: 'relative',
    backgroundColor: '#f8fafc',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    overflow: 'hidden',
  },
  btPickerDisabled: { backgroundColor: '#f1f5f9', opacity: 0.65 },
  btPicker: {
    height: 44,
    paddingHorizontal: 36,
    fontSize: 14,
    color: '#0f172a',
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  btPickerChevron: { position: 'absolute', left: 12, top: 15 },
  btInput: {
    backgroundColor: '#f8fafc',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14,
    color: '#0f172a',
    textAlign: 'right',
  },

  /* Footer */
  btFooter: {
    flexDirection: 'row-reverse',
    gap: 10,
    padding: 14,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#eceff1',
  },
  btCancelBtn: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 11,
    backgroundColor: '#eceff1',
    minWidth: 90,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btCancelText: { fontSize: 14, color: '#455a64', fontWeight: '700' },
  btConfirmBtn: {
    flex: 1,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 11,
    backgroundColor: '#e65100',
    shadowColor: '#e65100',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.30,
    shadowRadius: 8,
    elevation: 4,
  },
  btConfirmText: { fontSize: 14, color: '#fff', fontWeight: '800' },
});
