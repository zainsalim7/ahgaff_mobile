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
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Picker } from '@react-native-picker/picker';
import api, { departmentsAPI, coursesAPI, teachersAPI, settingsAPI } from '../../src/services/api';
import { Course, Department } from '../../src/types';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { useAuthStore } from '../../src/store/authStore';
import { SortableHeader } from '../../src/components/SortableHeader';
import { AssignTeacherModal } from '../../src/components/AssignTeacherModal';

interface Teacher {
  id: string;
  teacher_id: string;
  full_name: string;
  department_id?: string;
}

const LEVELS = ['1', '2', '3', '4', '5'];

// دالة التحقق من الصلاحيات
const checkPermission = (userRole: string, userPermissions: string[], permission: string): boolean => {
  if (userRole === 'admin') return true;
  return userPermissions?.includes(permission) || false;
};

// مكون بحث المعلمين
function TeacherSearchPicker({ teachers, selectedId, onSelect }: { teachers: any[], selectedId: string, onSelect: (id: string) => void }) {
  const [query, setQuery] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const selectedName = teachers.find(t => t.id === selectedId)?.full_name || '';

  const filtered = query.length > 0
    ? teachers.filter(t => t.full_name?.includes(query) || t.teacher_id?.includes(query))
    : teachers;

  return (
    <div style={{ position: 'relative', direction: 'rtl' }}>
      <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #ddd', borderRadius: 8, backgroundColor: '#f5f5f5', overflow: 'hidden' }}>
        <input
          type="text"
          value={open ? query : selectedName}
          onChange={(e: any) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="ابحث عن المعلم بالاسم..."
          style={{ flex: 1, padding: '10px 12px', border: 'none', background: 'transparent', fontSize: 14, outline: 'none', textAlign: 'right' }}
        />
        {selectedId && (
          <button onClick={() => { onSelect(''); setQuery(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 8px', color: '#e53935', fontSize: 16 }}>x</button>
        )}
      </div>
      {open && (
        <div style={{ position: 'absolute', top: 44, left: 0, right: 0, backgroundColor: '#fff', border: '1px solid #ddd', borderRadius: 8, maxHeight: 220, overflowY: 'auto', zIndex: 1000, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
          <div
            onClick={() => { onSelect(''); setQuery(''); setOpen(false); }}
            style={{ padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0', color: '#999', textAlign: 'right' }}
          >بدون معلم</div>
          {filtered.map((t: any) => (
            <div
              key={t.id}
              onClick={() => { onSelect(t.id); setQuery(''); setOpen(false); }}
              style={{ padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0', backgroundColor: t.id === selectedId ? '#e3f2fd' : '#fff', textAlign: 'right' }}
            >
              <div style={{ fontSize: 14, fontWeight: 600, color: '#333' }}>{t.full_name}</div>
              {t.teacher_id && <div style={{ fontSize: 11, color: '#888' }}>{t.teacher_id}</div>}
            </div>
          ))}
          {filtered.length === 0 && <div style={{ padding: '16px 12px', color: '#999', textAlign: 'center' }}>لا توجد نتائج</div>}
        </div>
      )}
      {open && <div onClick={() => setOpen(false)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 }} />}
    </div>
  );
}

export default function AddCourseScreen() {
  const router = useRouter();
  const authUser = useAuthStore((state) => state.user);
  const [courses, setCourses] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [faculties, setFaculties] = useState<any[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [enrollingAll, setEnrollingAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  
  // Search and filter
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterDept, setFilterDept] = useState<string>('');
  const [filterLevel, setFilterLevel] = useState<string>('');
  const [filterSection, setFilterSection] = useState<string>('');
  const [filterSemester, setFilterSemester] = useState<string>(''); // '' = الفصل النشط (افتراضي), 'all' = كل الفصول, أو semester_id محدد
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sharedDetailCourse, setSharedDetailCourse] = useState<Course | null>(null);
  const [sharedDetailData, setSharedDetailData] = useState<any>(null);
  const [integrityOpen, setIntegrityOpen] = useState(false);
  const [integrityData, setIntegrityData] = useState<any>(null);
  const [fixingLinks, setFixingLinks] = useState(false);
  const [mergeSel, setMergeSel] = useState<string[]>([]);
  const [mergeModal, setMergeModal] = useState(false);
  const [mergePrimary, setMergePrimary] = useState<string>('');
  const [mergePlan, setMergePlan] = useState<any>(null);
  const [merging, setMerging] = useState(false);
  const [activeSemester, setActiveSemester] = useState<any>(null);
  const [allSemesters, setAllSemesters] = useState<any[]>([]);
  
  // Pagination
  const PAGE_SIZE = 10;
  const [currentPage, setCurrentPage] = useState(1);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [perPage, setPerPage] = useState(10);
  
  // Multi-select for bulk delete
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  // حذف آمن
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteInfo, setDeleteInfo] = useState<any>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletingCourse, setDeletingCourse] = useState(false);
  
  // استعادة
  const [restoring, setRestoring] = useState(false);

  // استيراد Excel مقررات
  const [showImportModal, setShowImportModal] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [selectedDeptForImport, setSelectedDeptForImport] = useState<string>('');

  // استيراد محاضرات Excel
  const [showImportLecturesModal, setShowImportLecturesModal] = useState(false);
  const [importingLectures, setImportingLectures] = useState(false);
  const [importLecturesResult, setImportLecturesResult] = useState<any>(null);

  // مودال إسناد معلم سريع
  const [assignTeacherCourse, setAssignTeacherCourse] = useState<Course | null>(null);
  // مودال اختيار معلم في نموذج الإضافة/التعديل (formMode)
  const [showFormTeacherPicker, setShowFormTeacherPicker] = useState(false);
  // 🔧 الإسناد الجماعي — يستخدم selectionMode/selectedIds الموجودَين أصلاً
  const [showBulkAssign, setShowBulkAssign] = useState(false);

  // صلاحيات المستخدم
  const [userRole, setUserRole] = useState<string>('');
  const [userPermissions, setUserPermissions] = useState<string[]>([]);
  const canEdit = checkPermission(userRole, userPermissions, 'manage_courses');
  const canDelete = checkPermission(userRole, userPermissions, 'manage_courses');

  // تحميل صلاحيات المستخدم
  useEffect(() => {
    const loadUserPermissions = async () => {
      try {
        const storedUser = await AsyncStorage.getItem('user');
        if (storedUser) {
          const user = JSON.parse(storedUser);
          setUserRole(user.role || '');
          setUserPermissions(user.permissions || []);
        }
      } catch (error) {
        console.error('Error loading user permissions:', error);
      }
    };
    loadUserPermissions();
  }, []);

  const [formData, setFormData] = useState({
    name: '',
    code: '',
    department_id: '',
    teacher_id: '',
    level: '1',
    section: '',
    credit_hours: '3',
    practical_hours: '0',
  });
  const [sectionCount, setSectionCount] = useState('');
  const [extraSections, setExtraSections] = useState('');  // إضافة شُعب جديدة عند التعديل
  const SECTION_LABELS = ['أ', 'ب', 'ج', 'د', 'ه', 'و', 'ز', 'ح', 'ط', 'ي'];

  const [coursesLoading, setCoursesLoading] = useState(false);

  const fetchBaseData = useCallback(async () => {
    try {
      const [deptsRes, teachersRes, settingsRes, semRes, semsRes, facultiesRes] = await Promise.all([
        departmentsAPI.getAll(),
        teachersAPI.getAll(),
        settingsAPI.get(),
        api.get('/semesters/current').catch(() => ({ data: null })),
        api.get('/semesters').catch(() => ({ data: [] })),
        api.get('/faculties').catch(() => ({ data: [] })),
      ]);
      setDepartments(deptsRes.data);
      setTeachers(teachersRes.data);
      setSettings(settingsRes.data);
      setActiveSemester(semRes.data);
      const sl = Array.isArray(semsRes.data) ? semsRes.data : (semsRes.data?.items || []);
      setAllSemesters(sl);
      setFaculties(Array.isArray(facultiesRes.data) ? facultiesRes.data : []);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCourses = useCallback(async (deptId?: string) => {
    setCoursesLoading(true);
    try {
      const params: any = {};
      if (deptId && deptId !== 'all') {
        params.department_id = deptId;
      }
      // فلتر الفصل: 'all' = كل الفصول (default), '' = الفصل النشط، أو semester_id محدد
      if (filterSemester === 'all') {
        params.all_semesters = true;
      } else if (filterSemester) {
        params.semester_id = filterSemester;
      } else if (activeSemester?.id) {
        params.semester_id = activeSemester.id;
      } else {
        params.all_semesters = true;
      }
      const res = await coursesAPI.getAll(params);
      setCourses(res.data);
    } catch (error) {
      console.error('Error fetching courses:', error);
    } finally {
      setCoursesLoading(false);
    }
  }, [activeSemester, filterSemester]);

  // 🔧 حساب العبء الأسبوعي الحالي لكل معلم من المقررات المعروضة (تقدير)
  const teacherLoadMap = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const c of courses) {
      if (!c.teacher_id) continue;
      const ch = (c as any).credit_hours ?? 3;
      map[c.teacher_id] = (map[c.teacher_id] || 0) + ch;
    }
    return map;
  }, [courses]);

  useEffect(() => {
    fetchBaseData();
  }, [fetchBaseData]);

  useEffect(() => {
    // عرض كل المقررات افتراضياً (مع/بدون اختيار قسم)
    fetchCourses(filterDept || 'all');
  }, [filterDept, fetchCourses]);

  const handleSubmit = async () => {
    if (!formData.name || !formData.code || !formData.department_id) {
      if (Platform.OS === 'web') window.alert('الرجاء ملء جميع الحقول المطلوبة');
      else Alert.alert('خطأ', 'الرجاء ملء جميع الحقول المطلوبة');
      return;
    }

    setSaving(true);
    try {
      const _ch = parseInt(formData.credit_hours) || 3;
      const _ph = parseInt(formData.practical_hours) || 0;
      if (_ph > _ch) {
        if (Platform.OS === 'web') window.alert('الساعات العملية لا يمكن أن تتجاوز الساعات المعتمدة');
        else Alert.alert('خطأ', 'الساعات العملية لا يمكن أن تتجاوز الساعات المعتمدة');
        setSaving(false);
        return;
      }
      const baseData = {
        ...formData,
        level: parseInt(formData.level),
        credit_hours: _ch,
        practical_hours: _ph,
        semester_id: settings?.current_semester_id || null,
        academic_year: settings?.academic_year || '',
      };

      if (editingCourse) {
        // تعديل مقرر موجود
        const res = await coursesAPI.update(editingCourse.id, baseData);
        let msg = 'تم تحديث المقرر بنجاح';
        if (res.data?.warning) msg += '\n\n' + res.data.warning;

        // إنشاء شُعب إضافية (إن طُلبت)
        const extra = parseInt(extraSections) || 0;
        if (extra > 0) {
          const currentLabel = formData.section || 'أ';
          const currentIdx = SECTION_LABELS.indexOf(currentLabel);
          const startIdx = currentIdx >= 0 ? currentIdx + 1 : 1;
          let createdExtra = 0;
          let errorsExtra: string[] = [];
          // baseData يحتوي الشعبة الحالية، نُزيلها عند الاستنساخ
          const cloneBase = { ...baseData };
          delete (cloneBase as any).section;
          for (let i = 0; i < extra && (startIdx + i) < SECTION_LABELS.length; i++) {
            const sectionLabel = SECTION_LABELS[startIdx + i];
            try {
              await coursesAPI.create({ ...cloneBase, section: sectionLabel });
              createdExtra++;
            } catch (err: any) {
              errorsExtra.push(`شعبة ${sectionLabel}: ${err.response?.data?.detail || 'خطأ'}`);
            }
          }
          msg += `\n\nتم إضافة ${createdExtra} شعبة إضافية`;
          if (errorsExtra.length > 0) msg += '\nأخطاء:\n' + errorsExtra.join('\n');
        }
        setExtraSections('');

        if (Platform.OS === 'web') window.alert(msg);
        else Alert.alert('نجاح', msg);
      } else {
        const count = parseInt(sectionCount) || 0;
        if (count > 1) {
          // إنشاء شعب متعددة
          let created = 0;
          let errors: string[] = [];
          let createdIds: string[] = [];
          let totalMatching = 0;
          for (let i = 0; i < count && i < SECTION_LABELS.length; i++) {
            try {
              const res = await coursesAPI.create({ ...baseData, section: SECTION_LABELS[i] });
              created++;
              if (res.data?.id) createdIds.push(res.data.id);
              totalMatching += res.data?.matching_students_count || 0;
            } catch (err: any) {
              errors.push(`شعبة ${SECTION_LABELS[i]}: ${err.response?.data?.detail || 'خطأ'}`);
            }
          }
          let msg = `تم إنشاء ${created} شعبة من أصل ${count} لمقرر "${formData.name}"`;
          if (errors.length > 0) msg += '\n\nأخطاء:\n' + errors.join('\n');
          // سؤال التسجيل التلقائي للشعب المتعددة
          if (totalMatching > 0 && createdIds.length > 0) {
            const confirmMsg = `${msg}\n\nيوجد طلاب مطابقون.\nهل تريد تسجيلهم تلقائياً في الشعب الجديدة؟`;
            const doEnroll = Platform.OS === 'web' ? window.confirm(confirmMsg) : await new Promise(r => Alert.alert('تسجيل تلقائي', confirmMsg, [{ text: 'لا', onPress: () => r(false) }, { text: 'نعم', onPress: () => r(true) }]));
            if (doEnroll) {
              let totalEnrolled = 0;
              for (const cid of createdIds) {
                try {
                  const enrollRes = await api.post(`/courses/${cid}/auto-enroll`);
                  totalEnrolled += enrollRes.data?.enrolled || 0;
                } catch {}
              }
              const enrollMsg = `تم تسجيل ${totalEnrolled} طالب تلقائياً في ${createdIds.length} شعبة`;
              if (Platform.OS === 'web') window.alert(enrollMsg);
              else Alert.alert('نجاح', enrollMsg);
            }
          } else {
            if (Platform.OS === 'web') window.alert(msg);
            else Alert.alert('نتيجة', msg);
          }
        } else {
          // إنشاء مقرر واحد بدون شعبة
          const res = await coursesAPI.create(baseData);
          let msg = 'تم إضافة المقرر بنجاح';
          if (res.data?.warning) msg += '\n\n' + res.data.warning;
          // سؤال التسجيل التلقائي للطلاب المطابقين
          const matchCount = res.data?.matching_students_count || 0;
          if (matchCount > 0) {
            const courseId = res.data?.id;
            const confirmMsg = `${msg}\n\nيوجد ${matchCount} طالب مطابق (نفس القسم والمستوى${baseData.section ? ' والشعبة' : ''}).\nهل تريد تسجيلهم تلقائياً في هذا المقرر؟`;
            if (Platform.OS === 'web') {
              if (window.confirm(confirmMsg)) {
                try {
                  const enrollRes = await api.post(`/courses/${courseId}/auto-enroll`);
                  window.alert(`تم تسجيل ${enrollRes.data?.enrolled || 0} طالب تلقائياً`);
                } catch { window.alert('حدث خطأ أثناء التسجيل التلقائي'); }
              }
            } else {
              Alert.alert('تسجيل تلقائي', confirmMsg, [
                { text: 'لا', style: 'cancel' },
                { text: 'نعم', onPress: async () => {
                  try {
                    const enrollRes = await api.post(`/courses/${courseId}/auto-enroll`);
                    Alert.alert('نجاح', `تم تسجيل ${enrollRes.data?.enrolled || 0} طالب تلقائياً`);
                  } catch { Alert.alert('خطأ', 'حدث خطأ أثناء التسجيل التلقائي'); }
                }},
              ]);
            }
          } else {
            if (Platform.OS === 'web') window.alert(msg);
            else Alert.alert('نجاح', msg);
          }
        }
      }
      resetForm();
      setShowForm(false);
      setEditingCourse(null);
      fetchCourses(filterDept);
    } catch (error: any) {
      const message = error.response?.data?.detail || 'حدث خطأ';
      if (Platform.OS === 'web') window.alert(message);
      else Alert.alert('خطأ', message);
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      code: '',
      department_id: '',
      teacher_id: '',
      level: '1',
      section: '',
      credit_hours: '3',
      practical_hours: '0',
    });
    setSectionCount('');
  };

  // Toggle selection mode
  const toggleSelectionMode = () => {
    if (selectionMode) {
      setSelectedIds(new Set());
    }
    setSelectionMode(!selectionMode);
  };

  // Toggle single item selection
  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  // Select all visible items
  const selectAll = () => {
    const visibleIds = courses
      .filter(c => {
        if (searchQuery) {
          const query = searchQuery.toLowerCase();
          if (!c.name?.toLowerCase().includes(query) && !c.code?.toLowerCase().includes(query)) {
            return false;
          }
        }
        return true;
      })
      .map(c => c.id);
    setSelectedIds(new Set(visibleIds));
  };

  // Bulk delete
  const handleBulkDelete = () => {
    if (selectedIds.size === 0) return;
    
    if (Platform.OS === 'web') {
      const confirmed = window.confirm(`هل أنت متأكد من حذف ${selectedIds.size} مقرر؟ المقررات التي بها طلاب مسجلين لن يتم حذفها.`);
      if (confirmed) executeBulkDelete();
    } else {
      Alert.alert(
        'حذف متعدد',
        `هل أنت متأكد من حذف ${selectedIds.size} مقرر؟`,
        [
          { text: 'إلغاء', style: 'cancel' },
          { text: 'حذف', style: 'destructive', onPress: executeBulkDelete },
        ]
      );
    }
  };

  const executeBulkDelete = async () => {
    setDeleting(true);
    const errors: string[] = [];
    let successCount = 0;
    
    for (const id of Array.from(selectedIds)) {
      try {
        // استخدام الحذف الآمن الذي يتعامل مع المقررات التي بها طلاب
        await api.post(`/courses/${id}/safe-delete`);
        successCount++;
      } catch (error: any) {
        const detail = error?.response?.data?.detail || 'فشل في حذف المقرر';
        errors.push(detail);
      }
    }
    
    if (errors.length > 0) {
      const msg = `تم حذف ${successCount} مقرر. فشل ${errors.length}: ${errors[0]}`;
      if (Platform.OS === 'web') {
        window.alert(msg);
      } else {
        Alert.alert('نتيجة الحذف', msg);
      }
    } else {
      if (Platform.OS === 'web') {
        window.alert(`تم حذف ${successCount} مقرر بنجاح`);
      } else {
        Alert.alert('نجاح', `تم حذف ${successCount} مقرر`);
      }
    }
    
    setSelectedIds(new Set());
    setSelectionMode(false);
    fetchCourses(filterDept);
    setDeleting(false);
  };

  const handleEdit = (course: Course) => {
    setEditingCourse(course);
    setFormData({
      name: course.name,
      code: course.code,
      department_id: course.department_id,
      teacher_id: course.teacher_id || '',
      level: String(course.level),
      section: course.section || '',
      credit_hours: String(course.credit_hours || 3),
      practical_hours: String((course as any).practical_hours || 0),
    });
    setShowForm(true);
  };

  const handleDelete = async (courseId: string, courseName: string) => {
    setDeleteTarget({ id: courseId, name: courseName });
    setDeleteInfo(null);
    setShowDeleteModal(true);
    
    try {
      const token = await AsyncStorage.getItem('token');
      const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
      const res = await fetch(`${API_URL}/api/courses/${courseId}/backup-info`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      setDeleteInfo(data);
    } catch (error) {
      setDeleteInfo({ error: true });
    }
  };

  const confirmSafeDelete = async () => {
    if (!deleteTarget) return;
    setDeletingCourse(true);
    
    try {
      const token = await AsyncStorage.getItem('token');
      const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
      const res = await fetch(`${API_URL}/api/courses/${deleteTarget.id}/safe-delete`, {
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
          a.download = `backup_${deleteTarget.name}_${new Date().toISOString().split('T')[0]}.json`;
          a.click();
          URL.revokeObjectURL(url);
        }
        
        Alert.alert('نجاح', `تم حذف "${deleteTarget.name}" وتنزيل النسخة الاحتياطية`);
        setShowDeleteModal(false);
        setDeleteTarget(null);
        fetchCourses(filterDept);
      } else {
        Alert.alert('خطأ', data.detail || 'فشل في حذف المقرر');
      }
    } catch (error) {
      Alert.alert('خطأ', 'فشل في حذف المقرر');
    } finally {
      setDeletingCourse(false);
    }
  };

  const handleRestore = async () => {
    if (Platform.OS !== 'web') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (!file) return;
      
      setRestoring(true);
      try {
        const text = await file.text();
        const backupData = JSON.parse(text);
        
        if (backupData.backup_type !== 'course_backup') {
          Alert.alert('خطأ', 'ملف النسخة الاحتياطية غير صالح');
          setRestoring(false);
          return;
        }
        
        const courseName = backupData.course?.name || 'غير معروف';
        const studentsCount = backupData.students?.length || 0;
        const lecturesCount = backupData.lectures?.length || 0;
        
        if (!confirm(`استعادة المقرر "${courseName}"?\n- ${studentsCount} طالب\n- ${lecturesCount} محاضرة`)) {
          setRestoring(false);
          return;
        }
        
        const token = await AsyncStorage.getItem('token');
        const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
        const res = await fetch(`${API_URL}/api/courses/restore`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(backupData),
        });
        const data = await res.json();
        
        if (res.ok) {
          Alert.alert('نجاح', `تم استعادة "${courseName}" بنجاح`);
          fetchCourses(filterDept);
        } else {
          Alert.alert('خطأ', data.detail || 'فشل في الاستعادة');
        }
      } catch (error) {
        Alert.alert('خطأ', 'فشل في قراءة الملف');
      } finally {
        setRestoring(false);
      }
    };
    
    input.click();
  };

  const getDepartmentName = (deptId: string) => {
    const dept = departments.find(d => d.id === deptId);
    return dept?.name || 'غير محدد';
  };

  const handleDownloadTemplate = async () => {
    try {
      const res = await api.get('/template/courses', { responseType: 'blob' });
      if (Platform.OS === 'web') {
        const url = window.URL.createObjectURL(new Blob([res.data]));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'courses_template.xlsx';
        link.click();
        window.URL.revokeObjectURL(url);
      }
    } catch (e) {
      alert('فشل تحميل النموذج');
    }
  };

  const handleDownloadLecturesTemplate = async () => {
    try {
      const res = await api.get('/template/lectures', { responseType: 'blob' });
      if (Platform.OS === 'web') {
        const url = window.URL.createObjectURL(new Blob([res.data]));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'lectures_template.xlsx';
        link.click();
        window.URL.revokeObjectURL(url);
      }
    } catch (e: any) {
      const msg = e?.response?.status === 404 
        ? 'يجب إعادة نشر التطبيق لتفعيل هذه الميزة' 
        : 'فشل تحميل نموذج المحاضرات';
      if (Platform.OS === 'web') { window.alert(msg); } else { Alert.alert('خطأ', msg); }
    }
  };

  const handleImportLectures = async () => {
    if (Platform.OS !== 'web') return;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    input.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (!file) return;

      setImportingLectures(true);
      setImportLecturesResult(null);
      try {
        const formData = new FormData();
        formData.append('file', file);

        const res = await api.post('/import/lectures', formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        setImportLecturesResult(res.data);
        fetchCourses(filterDept);
      } catch (error: any) {
        setImportLecturesResult({
          message: error.response?.data?.detail || 'فشل في الاستيراد',
          imported: 0,
          errors: [],
        });
      } finally {
        setImportingLectures(false);
      }
    };
    input.click();
  };

  const handleImportCourses = async () => {
    if (!selectedDeptForImport) {
      alert('يجب اختيار القسم أولاً');
      return;
    }
    if (Platform.OS !== 'web') return;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    input.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (!file) return;

      setImporting(true);
      setImportResult(null);
      try {
        const formData = new FormData();
        formData.append('file', file);

        const res = await api.post(
          `/import/courses?department_id=${selectedDeptForImport}`,
          formData,
          { headers: { 'Content-Type': 'multipart/form-data' } }
        );
        setImportResult(res.data);
        fetchCourses(filterDept);
      } catch (error: any) {
        setImportResult({
          message: error.response?.data?.detail || 'فشل في الاستيراد',
          imported: 0,
          errors: [],
        });
      } finally {
        setImporting(false);
      }
    };
    input.click();
  };

  const getTeacherName = (teacherId: string) => {
    const teacher = teachers.find(t => t.id === teacherId);
    return teacher?.full_name || 'غير محدد';
  };

  const renderCourse = ({ item, index }: { item: Course; index: number }) => {
    const teacherName = item.teacher_name || getTeacherName(item.teacher_id);
    const studentsCount = item.students_count ?? 0;
    const lecturesCount = (item as any).lectures_count ?? 0;
    return (
      <View dataSet={{ responsive: "table-row" }} style={[styles.tRow, index % 2 === 1 && styles.tRowAlt, selectedIds.has(item.id) && styles.tRowSelected]}>
        <TouchableOpacity
          style={[styles.cCol1, styles.cellPad]}
          onPress={() => selectionMode ? toggleSelect(item.id) : router.push({ pathname: '/course-lectures', params: { courseId: item.id } })}
          onLongPress={() => { if (!selectionMode) { setSelectionMode(true); setSelectedIds(new Set([item.id])); } }}
        >
          {selectionMode ? (
            <View style={styles.rowCheckbox}>
              <Ionicons name={selectedIds.has(item.id) ? 'checkbox' : 'square-outline'} size={20} color={selectedIds.has(item.id) ? '#2962ff' : '#b0bbcc'} />
            </View>
          ) : (
            <View style={styles.bookAvatar}>
              <Ionicons name="book" size={16} color="#1565c0" />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 4 }}>
              <Text style={styles.tName} numberOfLines={1}>{item.name}</Text>
              {(item as any).source === 'curriculum' && (
                <View style={{ backgroundColor: '#ede7f6', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 }} testID={`course-source-curriculum-${item.id}`}>
                  <Text style={{ fontSize: 8.5, color: '#5e35b1', fontWeight: '800' }}>📚 من الخطة</Text>
                </View>
              )}
              {(item as any).source === 'import' && (
                <View style={{ backgroundColor: '#fff3e0', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 }} testID={`course-source-import-${item.id}`}>
                  <Text style={{ fontSize: 8.5, color: '#e65100', fontWeight: '800' }}>📥 من الاستيراد</Text>
                </View>
              )}
              {(((item as any).practical_hours || 0) > 0) && (
                <View style={{ backgroundColor: '#00695c', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 }} testID={`course-practical-badge-${item.id}`}>
                  <Text style={{ fontSize: 8.5, color: '#fff', fontWeight: '800' }}>🧪 {(item as any).practical_hours}ع</Text>
                </View>
              )}
              {(((item as any).shared_here) || (((item as any).shared_links || []).length > 0)) && (
                <TouchableOpacity
                  style={{ backgroundColor: '#e0f2f1', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 }}
                  testID={`course-shared-badge-${item.id}`}
                  onPress={async () => {
                    setSharedDetailCourse(item); setSharedDetailData(null);
                    try { const r = await api.get(`/courses/${item.id}/shared-details`); setSharedDetailData(r.data); }
                    catch { setSharedDetailData({ error: true }); }
                  }}
                >
                  <Text style={{ fontSize: 8.5, color: '#00695c', fontWeight: '800' }}>🔗 مشترك</Text>
                </TouchableOpacity>
              )}
            </View>
            <Text style={styles.tSubName}>{item.code}{item.section ? ` · شعبة ${item.section}` : ''}</Text>
          </View>
        </TouchableOpacity>
        <View style={[styles.cCol2, styles.cellPad]}>
          <Text style={styles.tCell} numberOfLines={1}>{getDepartmentName(item.department_id)}</Text>
        </View>
        <View style={[styles.cCol3, styles.cellPad]}>
          <Text style={styles.levelChip}>{item.level}</Text>
        </View>
        <View style={[styles.cCol4, styles.cellPad]}>
          {canEdit ? (
            item.teacher_id ? (
              <TouchableOpacity
                style={styles.teacherChipRow}
                onPress={() => setAssignTeacherCourse(item)}
                testID={`change-teacher-${item.id}`}
              >
                <Ionicons name="person-circle" size={16} color="#2962ff" />
                <Text style={styles.teacherChipText} numberOfLines={1}>{teacherName}</Text>
                <Ionicons name="pencil" size={11} color="#8a95a8" />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.assignTeacherBtn}
                onPress={() => setAssignTeacherCourse(item)}
                testID={`assign-teacher-${item.id}`}
              >
                <Ionicons name="person-add" size={13} color="#fff" />
                <Text style={styles.assignTeacherBtnText}>إسناد معلم</Text>
              </TouchableOpacity>
            )
          ) : (
            <Text style={styles.tCell} numberOfLines={1}>{teacherName || '—'}</Text>
          )}
        </View>
        <View style={[styles.cCol5, styles.cellPad]}>
          <View style={[styles.statChip, { backgroundColor: '#e7f0fe' }]}>
            <Ionicons name="people" size={11} color="#1565c0" />
            <Text style={[styles.statChipText, { color: '#1565c0' }]}>{studentsCount}</Text>
          </View>
        </View>
        <View style={[styles.cCol6, styles.cellPad]}>
          <View style={[styles.statChip, { backgroundColor: '#fff3e0' }]}>
            <Ionicons name="calendar" size={11} color="#e65100" />
            <Text style={[styles.statChipText, { color: '#e65100' }]}>{lecturesCount}</Text>
          </View>
        </View>
        <View style={[styles.cCol7, styles.cellPad]}>
          <TouchableOpacity
            style={styles.dotsBtn}
            onPress={() => setOpenMenuId(openMenuId === item.id ? null : item.id)}
            accessibilityLabel="العمليات"
          >
            <Ionicons name="ellipsis-vertical" size={18} color="#5b6678" />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        {showForm ? (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.pageScroll, { flexGrow: 1 }]} showsVerticalScrollIndicator={true}>
            <View style={styles.formCardModern}>
              <View style={styles.formHeaderModern}>
                <View style={{ flex: 1, alignItems: 'flex-end' }}>
                  <Text style={styles.formTitleModern}>
                    {editingCourse ? 'تعديل المقرر' : 'إضافة مقرر جديد'}
                  </Text>
                  <View style={styles.breadcrumb}>
                    <TouchableOpacity onPress={() => router.replace('/')}>
                      <Text style={styles.breadcrumbLink}>الرئيسية</Text>
                    </TouchableOpacity>
                    <Ionicons name="chevron-back" size={11} color="#8a95a8" />
                    <TouchableOpacity onPress={() => { setShowForm(false); setEditingCourse(null); resetForm(); }}>
                      <Text style={styles.breadcrumbLink}>المقررات</Text>
                    </TouchableOpacity>
                    <Ionicons name="chevron-back" size={11} color="#8a95a8" />
                    <Text style={styles.breadcrumbCurrent}>{editingCourse ? 'تعديل' : 'إضافة'}</Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.formCloseBtnModern}
                  onPress={() => { setShowForm(false); setEditingCourse(null); resetForm(); }}
                >
                  <Ionicons name="close" size={20} color="#5b6678" />
                </TouchableOpacity>
              </View>

              <Text style={styles.label}>اسم المقرر *</Text>
            <TextInput
              style={styles.input}
              value={formData.name}
              onChangeText={(text) => setFormData({ ...formData, name: text })}
              placeholder="أدخل اسم المقرر"
            />

            <Text style={styles.label}>رمز المقرر *</Text>
            <TextInput
              style={styles.input}
              value={formData.code}
              onChangeText={(text) => setFormData({ ...formData, code: text })}
              placeholder="مثال: CS101"
            />

            <Text style={styles.label}>القسم *</Text>
            <View style={styles.pickerWrapper}>
              <Picker
                selectedValue={formData.department_id}
                onValueChange={(value) => setFormData({ ...formData, department_id: value })}
                style={styles.picker}
              >
                <Picker.Item label="اختر القسم..." value="" />
                {departments.map(dept => (
                  <Picker.Item key={dept.id} label={dept.name} value={dept.id} />
                ))}
              </Picker>
            </View>

            <Text style={styles.label}>المعلم</Text>
            <TouchableOpacity
              style={styles.teacherPickerButton}
              onPress={() => setShowFormTeacherPicker(true)}
              testID="open-teacher-picker-btn"
            >
              <View style={{ flex: 1, alignItems: 'flex-end' }}>
                {formData.teacher_id ? (
                  <>
                    <Text style={styles.teacherPickerName}>
                      {teachers.find(t => t.id === formData.teacher_id)?.full_name || 'غير معروف'}
                    </Text>
                    <Text style={styles.teacherPickerHint}>اضغط للتغيير أو البحث</Text>
                  </>
                ) : (
                  <Text style={styles.teacherPickerPlaceholder}>اختر معلماً (بحث متاح)...</Text>
                )}
              </View>
              <Ionicons name="search" size={16} color="#5b6678" />
            </TouchableOpacity>

            <Text style={styles.label}>المستوى *</Text>
            <View style={styles.pickerWrapper}>
              <Picker
                selectedValue={formData.level}
                onValueChange={(value) => setFormData({ ...formData, level: value })}
                style={styles.picker}
              >
                {LEVELS.map(level => (
                  <Picker.Item key={level} label={`م${level}`} value={level} />
                ))}
              </Picker>
            </View>

            <Text style={styles.label}>الساعات المعتمدة</Text>
            <TextInput
              style={styles.input}
              value={formData.credit_hours}
              onChangeText={(text) => setFormData({ ...formData, credit_hours: text.replace(/[^0-9]/g, '') })}
              placeholder="3"
              keyboardType="numeric"
              data-testid="credit-hours-input"
            />

            <Text style={styles.label}>منها ساعات عملية 🧪 (اختياري)</Text>
            <TextInput
              style={styles.input}
              value={formData.practical_hours}
              onChangeText={(text) => setFormData({ ...formData, practical_hours: text.replace(/[^0-9]/g, '') })}
              placeholder="0"
              keyboardType="numeric"
              data-testid="practical-hours-input"
            />
            <Text style={{ fontSize: 11, color: '#666', marginBottom: 6, textAlign: 'right' }}>
              💡 الافتراضي 0 = كل الساعات نظرية · الساعة العملية تُحسب بنصف قيمتها في نصاب الأستاذ
            </Text>

            {editingCourse ? (
              <>
                <Text style={styles.label}>الشعبة (اختياري)</Text>
                <TextInput
                  style={styles.input}
                  value={formData.section}
                  onChangeText={(text) => setFormData({ ...formData, section: text })}
                  placeholder="مثال: أ أو ب"
                />
                {/* إضافة شُعب جديدة لنفس المقرر */}
                <Text style={[styles.label, { marginTop: 8 }]}>إضافة شُعب جديدة (اختياري)</Text>
                <Text style={{ fontSize: 11, color: '#666', marginBottom: 6, textAlign: 'right' }}>
                  💡 سيُنشئ شُعب جديدة بنفس بيانات المقرر بعد الترقيم الحالي
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <TextInput
                    style={[styles.input, { flex: 1, marginBottom: 0 }]}
                    value={extraSections}
                    onChangeText={(text) => {
                      const num = text.replace(/[^0-9]/g, '');
                      if (parseInt(num) > 10) return;
                      setExtraSections(num);
                    }}
                    placeholder="عدد الشُعب الإضافية (مثال: 2)"
                    keyboardType="numeric"
                    testID="extra-sections-input"
                  />
                </View>
                {parseInt(extraSections) > 0 && (() => {
                  const currentLabel = formData.section || 'أ';
                  const currentIdx = SECTION_LABELS.indexOf(currentLabel);
                  const startIdx = currentIdx >= 0 ? currentIdx + 1 : 1;
                  const nextLabels = SECTION_LABELS.slice(startIdx, startIdx + parseInt(extraSections));
                  return (
                    <View style={{ backgroundColor: '#e8f5e9', padding: 10, borderRadius: 8, marginTop: 6, marginBottom: 8 }}>
                      <Text style={{ fontSize: 12, color: '#2e7d32', fontWeight: '700', textAlign: 'center' }}>
                        ستُضاف شُعب: {nextLabels.join('، ')}
                      </Text>
                    </View>
                  );
                })()}
              </>
            ) : (
              <>
                <Text style={styles.label}>عدد الشعب (اختياري)</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <TextInput
                    style={[styles.input, { flex: 1, marginBottom: 0 }]}
                    value={sectionCount}
                    onChangeText={(text) => {
                      const num = text.replace(/[^0-9]/g, '');
                      if (parseInt(num) > 10) return;
                      setSectionCount(num);
                      if (parseInt(num) > 1) setFormData({ ...formData, section: '' });
                    }}
                    placeholder="اتركه فارغاً لمقرر واحد"
                    keyboardType="numeric"
                    data-testid="section-count-input"
                  />
                </View>
                {parseInt(sectionCount) > 1 && (
                  <View style={{ backgroundColor: '#e3f2fd', padding: 12, borderRadius: 8, marginBottom: 12 }}>
                    <Text style={{ fontSize: 13, color: '#1565c0', fontWeight: '600', textAlign: 'center' }}>
                      سيتم إنشاء {sectionCount} شعب: {SECTION_LABELS.slice(0, parseInt(sectionCount)).join('، ')}
                    </Text>
                  </View>
                )}
                {(!sectionCount || parseInt(sectionCount) <= 1) && (
                  <>
                    <Text style={[styles.label, { marginTop: 4 }]}>الشعبة (اختياري)</Text>
                    <TextInput
                      style={styles.input}
                      value={formData.section}
                      onChangeText={(text) => setFormData({ ...formData, section: text })}
                      placeholder="اتركه فارغاً أو اكتب مثال: أ"
                    />
                  </>
                )}
              </>
            )}

            {/* عرض الفصل الحالي - للإشارة فقط */}
            {settings && (
              <View style={styles.semesterInfo}>
                <Ionicons name="calendar" size={18} color="#1565c0" />
                <Text style={styles.semesterInfoText}>
                  سيتم ربط المقرر بـ: {settings.current_semester} - {settings.academic_year}
                </Text>
              </View>
            )}

            <View style={styles.formButtons}>
              <TouchableOpacity
                style={[styles.btn, styles.cancelBtn]}
                onPress={() => {
                  setShowForm(false);
                  setEditingCourse(null);
                  resetForm();
                }}
              >
                <Text style={styles.cancelBtnText}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.saveBtn]}
                onPress={handleSubmit}
                disabled={saving}
              >
                <Text style={styles.saveBtnText}>
                  {saving ? 'جاري الحفظ...' : editingCourse ? 'تحديث' : 'حفظ'}
                </Text>
              </TouchableOpacity>
            </View>
            </View>
          </ScrollView>
        ) : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.pageScroll, { flexGrow: 1 }]} showsVerticalScrollIndicator={true}>

            {/* رأس الصفحة */}
            <View dataSet={{ responsive: "page-header" }} style={styles.pageHeader}>
              <View style={styles.pageHeaderRight}>
                <Text dataSet={{ responsive: "page-title" }} style={styles.pageTitle}>المقررات</Text>
                <View style={styles.breadcrumb}>
                  <TouchableOpacity onPress={() => router.replace('/')}>
                    <Text style={styles.breadcrumbLink}>الرئيسية</Text>
                  </TouchableOpacity>
                  <Ionicons name="chevron-back" size={12} color="#8a95a8" />
                  <Text style={styles.breadcrumbCurrent}>المقررات</Text>
                </View>
                {activeSemester?.name && (
                  <View style={styles.semesterBadge}>
                    <Ionicons name="calendar" size={11} color="#1565c0" />
                    <Text style={styles.semesterBadgeText}>{activeSemester.name}</Text>
                  </View>
                )}
              </View>

              <View dataSet={{ responsive: "page-header-actions" }} style={styles.pageHeaderActions}>
                {!selectionMode ? (
                  <>
                    {canEdit && (
                      <TouchableOpacity
                        style={[styles.headerBtn, styles.btnPrimary]}
                        onPress={() => {
                          const proceed = Platform.OS !== 'web' ? true : window.confirm(
                            '💡 ملاحظة:\n\nفي الغالب تُنشأ المقررات تلقائياً من "الخطة الدراسية" بالضغط على "توليد للفصل النشط".\n\nاستخدم هذه الميزة فقط لإضافة مقرر استثنائي خارج الخطة.\n\nهل تريد المتابعة؟'
                          );
                          if (proceed) setShowForm(true);
                        }}
                      >
                        <Ionicons name="add" size={16} color="#fff" />
                        <Text style={styles.btnPrimaryText}>إضافة مقرر</Text>
                      </TouchableOpacity>
                    )}
                    {canEdit && Platform.OS === 'web' && (
                      <TouchableOpacity style={[styles.headerBtn, styles.btnSuccess]} onPress={() => { setShowImportModal(true); setImportResult(null); }}>
                        <Ionicons name="document-text-outline" size={16} color="#fff" />
                        <Text style={styles.btnPrimaryText}>استيراد Excel</Text>
                      </TouchableOpacity>
                    )}
                    {canDelete && (
                      <TouchableOpacity style={[styles.headerBtn, styles.btnGhost]} onPress={toggleSelectionMode}>
                        <Ionicons name="checkbox-outline" size={16} color="#1a2540" />
                        <Text style={styles.btnGhostText}>تحديد</Text>
                      </TouchableOpacity>
                    )}
                    {canEdit && Platform.OS === 'web' && (
                      <TouchableOpacity
                        style={[styles.headerBtn, styles.btnGhost]}
                        onPress={() => setOpenMenuId('__more__')}
                      >
                        <Ionicons name="ellipsis-horizontal" size={16} color="#1a2540" />
                        <Text style={styles.btnGhostText}>المزيد</Text>
                      </TouchableOpacity>
                    )}
                  </>
                ) : (
                  <>
                    <TouchableOpacity style={[styles.headerBtn, styles.btnGhost]} onPress={toggleSelectionMode}>
                      <Ionicons name="close" size={16} color="#1a2540" />
                      <Text style={styles.btnGhostText}>إلغاء</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.headerBtn, { backgroundColor: '#ff9800' }]} onPress={() => { if (selectedIds.size > 0) setSelectedIds(new Set()); else selectAll(); }}>
                      <Ionicons name={selectedIds.size > 0 ? 'close-circle-outline' : 'checkbox-outline'} size={16} color="#fff" />
                      <Text style={styles.btnPrimaryText}>{selectedIds.size > 0 ? `إلغاء التحديد (${selectedIds.size})` : 'تحديد الكل'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.headerBtn, { backgroundColor: '#2962ff' }]}
                      onPress={() => setShowBulkAssign(true)}
                      disabled={selectedIds.size === 0}
                      testID="open-bulk-assign-btn"
                    >
                      <Ionicons name="people" size={16} color="#fff" />
                      <Text style={styles.btnPrimaryText}>إسناد جماعي ({selectedIds.size})</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.headerBtn, { backgroundColor: '#7b1fa2' }]}
                      onPress={() => { const ids = Array.from(selectedIds); setMergeSel(ids); setMergePrimary(ids[0]); setMergePlan(null); setMergeModal(true); }}
                      disabled={selectedIds.size < 2}
                      testID="merge-courses-btn"
                    >
                      <Ionicons name="git-merge-outline" size={16} color="#fff" />
                      <Text style={styles.btnPrimaryText}>دمج كمشترك ({selectedIds.size})</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.headerBtn, { backgroundColor: '#f44336' }]} onPress={handleBulkDelete} disabled={selectedIds.size === 0 || deleting}>
                      {deleting ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="trash" size={16} color="#fff" />}
                      <Text style={styles.btnPrimaryText}>حذف ({selectedIds.size})</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>

            {/* بطاقات الإحصائيات */}
            {(() => {
              const filtered = courses.filter(c => {
                if (searchQuery) {
                  const q = searchQuery.toLowerCase();
                  if (!c.name?.toLowerCase().includes(q) && !c.code?.toLowerCase().includes(q)) return false;
                }
                if (filterLevel) {
                  const links = ((c as any).shared_links || []) as any[];
                  const inSelectedDept = !filterDept || filterDept === 'all' || c.department_id === filterDept;
                  const nativeOk = inSelectedDept && String(c.level) === filterLevel;
                  const sharedOk = links.some((l: any) => String(l.level) === filterLevel && (!filterDept || filterDept === 'all' || l.department_id === filterDept));
                  if (!nativeOk && !sharedOk) return false;
                }
                if (filterSection && (c.section || '') !== filterSection) return false;
                return true;
              });
              // 🔤 فرز ديناميكي
              if (sortBy) {
                filtered.sort((a: any, b: any) => {
                  let cmp = 0;
                  if (sortBy.startsWith('name_')) cmp = (a.name || '').localeCompare((b.name || ''), 'ar');
                  else if (sortBy.startsWith('level_')) cmp = ((a.level as number) || 0) - ((b.level as number) || 0);
                  else if (sortBy.startsWith('students_')) cmp = (a.students_count || 0) - (b.students_count || 0);
                  else if (sortBy.startsWith('lectures_')) cmp = ((a as any).lectures_count || 0) - ((b as any).lectures_count || 0);
                  return sortBy.endsWith('_desc') ? -cmp : cmp;
                });
              }
              const totalStudents = courses.reduce((s, c) => s + (c.students_count ?? 0), 0);
              const totalLectures = courses.reduce((s, c) => s + ((c as any).lectures_count ?? 0), 0);
              const totalPages = Math.ceil(filtered.length / perPage);
              const paged = filtered.slice((currentPage - 1) * perPage, currentPage * perPage);
              return (
                <>
                  <View dataSet={{ responsive: "stats-grid" }} style={styles.statsGrid}>
                    <View style={styles.statCard}>
                      <View style={[styles.statIconWrap, { backgroundColor: '#4caf50' }]}><Ionicons name="book" size={22} color="#fff" /></View>
                      <View style={styles.statTextCol}>
                        <Text style={styles.statLabel}>إجمالي المقررات</Text>
                        <Text style={styles.statValue}>{courses.length}</Text>
                        <Text style={styles.statSubLabel}>مقرر</Text>
                      </View>
                    </View>
                    <View style={styles.statCard}>
                      <View style={[styles.statIconWrap, { backgroundColor: '#29b6f6' }]}><Ionicons name="eye" size={22} color="#fff" /></View>
                      <View style={styles.statTextCol}>
                        <Text style={styles.statLabel}>المعروض حالياً</Text>
                        <Text style={styles.statValue}>{filtered.length}</Text>
                        <Text style={styles.statSubLabel}>من {courses.length} مقرر</Text>
                      </View>
                    </View>
                    <View style={styles.statCard}>
                      <View style={[styles.statIconWrap, { backgroundColor: '#ff9800' }]}><Ionicons name="people" size={22} color="#fff" /></View>
                      <View style={styles.statTextCol}>
                        <Text style={styles.statLabel}>إجمالي الطلاب</Text>
                        <Text style={styles.statValue}>{totalStudents.toLocaleString('en-US')}</Text>
                        <Text style={styles.statSubLabel}>تسجيل</Text>
                      </View>
                    </View>
                    <View style={styles.statCard}>
                      <View style={[styles.statIconWrap, { backgroundColor: '#7c4dff' }]}><Ionicons name="calendar" size={22} color="#fff" /></View>
                      <View style={styles.statTextCol}>
                        <Text style={styles.statLabel}>إجمالي المحاضرات</Text>
                        <Text style={styles.statValue}>{totalLectures.toLocaleString('en-US')}</Text>
                        <Text style={styles.statSubLabel}>محاضرة</Text>
                      </View>
                    </View>
                  </View>

                  {/* بطاقة الفلاتر */}
                  <View style={styles.filterCard}>
                    <View dataSet={{ responsive: "filter-row" }} style={styles.filterRow}>
                      <View style={styles.filterField}>
                        <View style={styles.searchBox}>
                          <Ionicons name="search" size={16} color="#8a95a8" />
                          <TextInput
                            style={styles.searchBoxInput}
                            placeholder="ابحث بالاسم أو الرمز..."
                            value={searchQuery}
                            onChangeText={(t) => { setSearchQuery(t); setCurrentPage(1); }}
                            placeholderTextColor="#a8b1c2"
                          />
                        </View>
                      </View>
                      <View style={styles.filterField}>
                        <Text style={styles.filterLbl}>القسم</Text>
                        <View style={styles.dropdown}>
                          <Picker
                            selectedValue={filterDept}
                            onValueChange={(v) => { setFilterDept(v); setCurrentPage(1); }}
                            style={styles.dropdownInner}
                          >
                            <Picker.Item label="اختر القسم..." value="" />
                            {authUser?.role === 'admin' && <Picker.Item label="الكل" value="all" />}
                            {departments.map(d => <Picker.Item key={d.id} label={d.name} value={d.id} />)}
                          </Picker>
                        </View>
                      </View>
                      <View style={styles.filterField}>
                        <Text style={styles.filterLbl}>الفصل</Text>
                        <View style={styles.dropdown}>
                          <Picker
                            selectedValue={filterSemester}
                            onValueChange={(v) => { setFilterSemester(v); setCurrentPage(1); }}
                            style={styles.dropdownInner}
                          >
                            <Picker.Item label={activeSemester ? `الفصل النشط (${activeSemester.name})` : 'الفصل النشط'} value="" />
                            <Picker.Item label="كل الفصول" value="all" />
                            {allSemesters.filter(s => s.id !== activeSemester?.id).map(s => (
                              <Picker.Item key={s.id} label={s.name} value={s.id} />
                            ))}
                          </Picker>
                        </View>
                      </View>
                      <View style={[styles.filterField, { maxWidth: 130 }]}>
                        <Text style={styles.filterLbl}>المستوى</Text>
                        <View style={styles.dropdown}>
                          <Picker
                            selectedValue={filterLevel}
                            onValueChange={(v) => { setFilterLevel(v); setCurrentPage(1); }}
                            style={styles.dropdownInner}
                          >
                            <Picker.Item label="الكل" value="" />
                            {LEVELS.map(l => <Picker.Item key={l} label={`م${l}`} value={l} />)}
                          </Picker>
                        </View>
                      </View>
                      <View style={[styles.filterField, { maxWidth: 130 }]}>
                        <Text style={styles.filterLbl}>الشعبة</Text>
                        <View style={styles.dropdown}>
                          <Picker
                            selectedValue={filterSection}
                            onValueChange={(v) => { setFilterSection(v); setCurrentPage(1); }}
                            style={styles.dropdownInner}
                          >
                            <Picker.Item label="الكل" value="" />
                            {Array.from(new Set(courses.map(c => c.section).filter(Boolean))).sort().map(s => (
                              <Picker.Item key={s} label={s} value={s} />
                            ))}
                          </Picker>
                        </View>
                      </View>
                      <View style={styles.filterBtns}>
                        <TouchableOpacity style={styles.resetBtn} onPress={() => { setFilterDept(''); setSearchQuery(''); setFilterSemester(''); setFilterLevel(''); setFilterSection(''); setCurrentPage(1); }} disabled={!filterDept && !searchQuery && !filterSemester && !filterLevel && !filterSection}>
                          <Ionicons name="refresh" size={13} color={(filterDept || searchQuery || filterSemester || filterLevel || filterSection) ? '#2962ff' : '#a8b1c2'} />
                          <Text style={[styles.resetBtnText, !(filterDept || searchQuery || filterSemester || filterLevel || filterSection) && { color: '#a8b1c2' }]}>إعادة تعيين</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.headerBtn, styles.btnPrimary, { paddingHorizontal: 18 }]}>
                          <Text style={styles.btnPrimaryText}>تطبيق الفلتر</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>

                  {/* بطاقة الجدول — لا تعرض حتى يختار المستخدم فلتراً */}
                  {!(filterDept || searchQuery || filterSemester || filterLevel || filterSection) ? (
                    <View style={{ backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#eef1f6', padding: 50, alignItems: 'center', gap: 14 }}>
                      <Ionicons name="filter-circle-outline" size={72} color="#cfd6e1" />
                      <Text style={{ fontSize: 17, fontWeight: '700', color: '#1a2540', textAlign: 'center' }}>اختر فلتراً لعرض المقررات</Text>
                      <Text style={{ fontSize: 13, color: '#8a95a8', textAlign: 'center', maxWidth: 460, lineHeight: 22 }}>
                        حدّد قسماً أو فصلاً معيناً، أو اكتب اسم/كود مقرر في حقل البحث أعلاه لعرض النتائج.
                      </Text>
                    </View>
                  ) : (
                  <View style={styles.tableCard}>
                    <View style={styles.tableCardHeader}>
                      <Text style={styles.tableCardTitle}>قائمة المقررات</Text>
                      <Text style={styles.tableCardCount}>
                        عرض <Text style={styles.tableCardCountAccent}>{filtered.length}</Text> من <Text style={styles.tableCardCountAccent}>{courses.length}</Text> مقرر
                      </Text>
                    </View>

                    {coursesLoading ? (
                      <View style={styles.tableEmpty}>
                        <ActivityIndicator size="large" color="#2962ff" />
                        <Text style={styles.tableEmptyText}>جاري تحميل المقررات...</Text>
                      </View>
                    ) : (
                      <>
                        <View dataSet={{ responsive: "table-header-row" }} style={styles.tableHeaderRow}>
                          <SortableHeader label="المقرر" field="name" currentSort={sortBy} onSort={(v) => { setSortBy(v); setCurrentPage(1); }} containerStyle={[styles.cCol1, styles.cellPad]} />
                          <View style={[styles.cCol2, styles.cellPad]}><Text style={styles.thText}>القسم</Text></View>
                          <SortableHeader label="المستوى" field="level" currentSort={sortBy} onSort={(v) => { setSortBy(v); setCurrentPage(1); }} containerStyle={[styles.cCol3, styles.cellPad]} />
                          <View style={[styles.cCol4, styles.cellPad]}><Text style={styles.thText}>المعلم</Text></View>
                          <SortableHeader label="الطلاب" field="students" currentSort={sortBy} onSort={(v) => { setSortBy(v); setCurrentPage(1); }} containerStyle={[styles.cCol5, styles.cellPad]} />
                          <SortableHeader label="المحاضرات" field="lectures" currentSort={sortBy} onSort={(v) => { setSortBy(v); setCurrentPage(1); }} containerStyle={[styles.cCol6, styles.cellPad]} />
                          <View style={[styles.cCol7, styles.cellPad]}><Text style={styles.thText}>العمليات</Text></View>
                        </View>
                        {paged.length === 0 ? (
                          <View style={styles.tableEmpty}>
                            <Ionicons name="book-outline" size={48} color="#cfd6e1" />
                            <Text style={styles.tableEmptyText}>لا توجد نتائج</Text>
                          </View>
                        ) : (
                          <View>
                            {paged.map((item, index) => (
                              <View key={item.id}>{renderCourse({ item, index })}</View>
                            ))}
                          </View>
                        )}

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
                          {totalPages > 1 && (
                            <View style={styles.pagerWrap}>
                              <TouchableOpacity style={[styles.pagerNavBtn, currentPage <= 1 && styles.pagerNavBtnDisabled]} onPress={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1}>
                                <Ionicons name="chevron-forward" size={14} color={currentPage <= 1 ? '#c0c8d4' : '#1a2540'} />
                                <Text style={[styles.pagerNavText, currentPage <= 1 && { color: '#c0c8d4' }]}>السابق</Text>
                              </TouchableOpacity>
                              {(() => {
                                const pages: (number | 'dots')[] = [];
                                pages.push(1);
                                if (currentPage > 4) pages.push('dots');
                                const start = Math.max(2, currentPage - 1);
                                const end = Math.min(totalPages - 1, currentPage + 1);
                                for (let i = start; i <= end; i++) pages.push(i);
                                if (currentPage < totalPages - 3) pages.push('dots');
                                if (totalPages > 1) pages.push(totalPages);
                                return pages.map((p, idx) => p === 'dots' ? (
                                  <Text key={`d-${idx}`} style={styles.pagerDots}>...</Text>
                                ) : (
                                  <TouchableOpacity key={p} style={[styles.pagerBtn, currentPage === p && styles.pagerBtnActive]} onPress={() => setCurrentPage(p as number)}>
                                    <Text style={[styles.pagerBtnText, currentPage === p && styles.pagerBtnTextActive]}>{p}</Text>
                                  </TouchableOpacity>
                                ));
                              })()}
                              <TouchableOpacity style={[styles.pagerNavBtn, currentPage >= totalPages && styles.pagerNavBtnDisabled]} onPress={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages}>
                                <Text style={[styles.pagerNavText, currentPage >= totalPages && { color: '#c0c8d4' }]}>التالي</Text>
                                <Ionicons name="chevron-back" size={14} color={currentPage >= totalPages ? '#c0c8d4' : '#1a2540'} />
                              </TouchableOpacity>
                            </View>
                          )}
                        </View>
                      </>
                    )}
                  </View>
                  )}
                </>
              );
            })()}
          </ScrollView>
        )}
      </KeyboardAvoidingView>

      {/* قائمة العمليات (3 نقاط) لكل مقرر */}
      {openMenuId && openMenuId !== '__more__' && (() => {
        const c = courses.find(x => x.id === openMenuId);
        if (!c) return null;
        return (
          <Modal visible transparent animationType="fade" onRequestClose={() => setOpenMenuId(null)}>
            <View style={styles.modalOverlay}>
              <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setOpenMenuId(null)} />
              <View style={styles.menuModalCard}>
                <View style={styles.menuModalHeader}>
                  <Text style={styles.menuModalTitle} numberOfLines={1}>{c.name}</Text>
                  <TouchableOpacity onPress={() => setOpenMenuId(null)}><Ionicons name="close" size={20} color="#5b6678" /></TouchableOpacity>
                </View>
                <TouchableOpacity style={styles.menuItem} onPress={() => { setOpenMenuId(null); router.push({ pathname: '/course-lectures', params: { courseId: c.id } }); }}>
                  <Ionicons name="calendar-outline" size={18} color="#9c27b0" />
                  <Text style={styles.menuText}>المحاضرات</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.menuItem} onPress={() => { setOpenMenuId(null); router.push({ pathname: '/course-students', params: { courseId: c.id } }); }}>
                  <Ionicons name="people-outline" size={18} color="#1565c0" />
                  <Text style={styles.menuText}>الطلاب</Text>
                </TouchableOpacity>
                {canEdit && (
                  <TouchableOpacity style={styles.menuItem} onPress={() => { setOpenMenuId(null); router.push({ pathname: '/manage-study-plan', params: { courseId: c.id, courseName: c.name } }); }}>
                    <Ionicons name="book-outline" size={18} color="#2e7d32" />
                    <Text style={styles.menuText}>الخطة الدراسية</Text>
                  </TouchableOpacity>
                )}
                {canEdit && (
                  <TouchableOpacity style={styles.menuItem} onPress={() => { setOpenMenuId(null); handleEdit(c); }}>
                    <Ionicons name="pencil-outline" size={18} color="#ff9800" />
                    <Text style={styles.menuText}>تعديل</Text>
                  </TouchableOpacity>
                )}
                {canDelete && (
                  <TouchableOpacity style={[styles.menuItem, styles.menuItemDanger]} onPress={() => { setOpenMenuId(null); handleDelete(c.id, c.name); }}>
                    <Ionicons name="trash-outline" size={18} color="#f44336" />
                    <Text style={[styles.menuText, { color: '#f44336' }]}>حذف</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </Modal>
        );
      })()}

      {/* قائمة "المزيد" - أدوات إضافية */}
      {openMenuId === '__more__' && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setOpenMenuId(null)}>
          <View style={styles.modalOverlay}>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setOpenMenuId(null)} />
            <View style={styles.menuModalCard}>
              <View style={styles.menuModalHeader}>
                <Text style={styles.menuModalTitle}>أدوات إضافية</Text>
                <TouchableOpacity onPress={() => setOpenMenuId(null)}><Ionicons name="close" size={20} color="#5b6678" /></TouchableOpacity>
              </View>
              <TouchableOpacity style={styles.menuItem} onPress={() => { setOpenMenuId(null); handleDownloadTemplate(); }}>
                <Ionicons name="download-outline" size={18} color="#2e7d32" />
                <Text style={styles.menuText}>تنزيل نموذج المقررات</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.menuItem} onPress={() => { setOpenMenuId(null); handleDownloadLecturesTemplate(); }}>
                <Ionicons name="download-outline" size={18} color="#6a1b9a" />
                <Text style={styles.menuText}>تنزيل نموذج المحاضرات</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.menuItem} onPress={() => { setOpenMenuId(null); setShowImportLecturesModal(true); setImportLecturesResult(null); }}>
                <Ionicons name="cloud-upload-outline" size={18} color="#e65100" />
                <Text style={styles.menuText}>استيراد محاضرات</Text>
              </TouchableOpacity>
              {filterDept && (
                <TouchableOpacity style={styles.menuItem} onPress={async () => {
                  setOpenMenuId(null);
                  const msg = `تسجيل تلقائي للطلاب في جميع مقررات القسم؟\nسيتم ربط كل طالب بالمقررات المطابقة لمستواه وشعبته\n\nالطلاب المسجلين مسبقاً لن يتأثروا`;
                  if (Platform.OS === 'web' && !window.confirm(msg)) return;
                  setEnrollingAll(true);
                  try {
                    const res = await api.post(`/courses/auto-enroll-all?department_id=${filterDept}`);
                    const d = res.data;
                    const resultMsg = `${d.message}\n\nمسجلين مسبقاً: ${d.total_already_enrolled}\n\n${d.details.length > 0 ? 'التفاصيل:\n' + d.details.join('\n') : 'لا توجد تسجيلات جديدة'}`;
                    if (Platform.OS === 'web') window.alert(resultMsg); else Alert.alert('نتيجة', resultMsg);
                    fetchCourses(filterDept);
                  } catch (e: any) {
                    const errMsg = e?.response?.data?.detail || 'حدث خطأ';
                    if (Platform.OS === 'web') window.alert(errMsg); else Alert.alert('خطأ', errMsg);
                  } finally { setEnrollingAll(false); }
                }} disabled={enrollingAll}>
                  <Ionicons name="people-outline" size={18} color="#00897b" />
                  <Text style={styles.menuText}>{enrollingAll ? 'جاري التسجيل...' : 'تسجيل تلقائي للكل'}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.menuItem} testID="sync-enrollments-btn" onPress={async () => {
                setOpenMenuId(null);
                const scope = filterDept && filterDept !== 'all' ? 'لطلاب هذا القسم' : 'لجميع الطلاب';
                const msg = `مزامنة تسجيلات الطلاب ${scope}؟\n\n🔄 سيُزال أي تسجيل في الفصل النشط لا يطابق موقع الطالب الحالي (قسمه/مستواه/شعبته)، وتُضاف المقررات الناقصة.\n\nمفيد لتصحيح الطلاب المنقولين سابقاً العالقين بمقررات قديمة.`;
                if (Platform.OS === 'web' && !window.confirm(msg)) return;
                setEnrollingAll(true);
                try {
                  const url = filterDept && filterDept !== 'all' ? `/students/sync-enrollments?department_id=${filterDept}` : '/students/sync-enrollments';
                  const res = await api.post(url);
                  if (Platform.OS === 'web') window.alert(res.data.message); else Alert.alert('نتيجة', res.data.message);
                  fetchCourses(filterDept);
                } catch (e: any) {
                  const errMsg = e?.response?.data?.detail || 'حدث خطأ';
                  if (Platform.OS === 'web') window.alert(errMsg); else Alert.alert('خطأ', errMsg);
                } finally { setEnrollingAll(false); }
              }} disabled={enrollingAll}>
                <Ionicons name="sync-outline" size={18} color="#7b1fa2" />
                <Text style={styles.menuText}>مزامنة تسجيلات الطلاب</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.menuItem} testID="shared-links-integrity-btn" onPress={async () => {
                setOpenMenuId(null); setIntegrityOpen(true); setIntegrityData(null);
                try { const r = await api.get('/courses-tools/shared-links-integrity'); setIntegrityData(r.data); }
                catch { setIntegrityData({ error: true }); }
              }}>
                <Ionicons name="pulse-outline" size={18} color="#00695c" />
                <Text style={styles.menuText}>فحص سلامة المشاركات</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.menuItem} onPress={() => { setOpenMenuId(null); handleRestore(); }} disabled={restoring}>
                <Ionicons name="refresh-outline" size={18} color="#1565c0" />
                <Text style={styles.menuText}>{restoring ? 'جاري...' : 'استعادة'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
      
      {/* 🧩 نافذة دمج المقررات */}
      {mergeModal && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setMergeModal(false)}>
          <View style={styles.modalOverlay}>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setMergeModal(false)} />
            <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 18, width: '92%', maxWidth: 540, maxHeight: '88%' }} testID="merge-modal">
              <Text style={{ fontSize: 15, fontWeight: '800', color: '#1a2540', textAlign: 'right', marginBottom: 4 }}>🧩 دمج كمقرر مشترك</Text>
              <Text style={{ fontSize: 11.5, color: '#5b6678', textAlign: 'right', marginBottom: 10, lineHeight: 18 }}>
                اختر المقرر الأساسي (يُعتمد اسمه ورمزه) — تنتقل إليه خانات الجدول والطلاب والمحاضرات والحضور، وتُحذف المقررات الأخرى بعد نقل كل شيء.
              </Text>
              <ScrollView style={{ maxHeight: 400 }}>
                {mergeSel.map(id => {
                  const c = courses.find(x => x.id === id);
                  if (!c) return null;
                  const isPrim = mergePrimary === id;
                  return (
                    <TouchableOpacity key={id} onPress={() => { setMergePrimary(id); setMergePlan(null); }}
                      style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8, borderWidth: isPrim ? 2 : 1, borderColor: isPrim ? '#7b1fa2' : '#e3e9f2', backgroundColor: isPrim ? '#f7f0fb' : '#fafbfd', borderRadius: 10, padding: 10, marginBottom: 6 }}
                      testID={`merge-primary-${id}`}
                    >
                      <View style={{ width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: isPrim ? '#7b1fa2' : '#c3ccda', backgroundColor: isPrim ? '#7b1fa2' : '#fff' }} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: '#1a2540', textAlign: 'right' }}>{c.name}</Text>
                        <Text style={{ fontSize: 11, color: '#5b6678', textAlign: 'right' }}>م{c.level}{c.section ? ` · شعبة ${c.section}` : ''}{(c as any).code ? ` · ${(c as any).code}` : ''}</Text>
                      </View>
                      {isPrim && <Text style={{ fontSize: 10, color: '#7b1fa2', fontWeight: '800' }}>الأساسي</Text>}
                    </TouchableOpacity>
                  );
                })}
                {mergePlan && !mergePlan.error && (
                  <View style={{ backgroundColor: '#f2fbfa', borderWidth: 1, borderColor: '#b2dfdb', borderRadius: 10, padding: 10, marginTop: 4 }} testID="merge-plan-box">
                    <Text style={{ fontSize: 12.5, fontWeight: '800', color: '#00695c', textAlign: 'right', marginBottom: 4 }}>📋 المعاينة قبل التنفيذ</Text>
                    <Text style={{ fontSize: 11.5, color: '#37455c', textAlign: 'right', lineHeight: 20 }}>
                      • خانات جدول ستنتقل: {mergePlan.plan.slots_to_move}{'\n'}
                      • مجموعات محاضرات متزامنة ستُدمج: {mergePlan.plan.sync_groups}{'\n'}
                      • طلاب سينضمون للمقرر الأساسي: {mergePlan.plan.students_to_move}{'\n'}
                      • محاضرات يومية ستنتقل: {mergePlan.plan.lectures_to_move} (ودمج {mergePlan.plan.lectures_to_merge} مكررة بحضورها){'\n'}
                      • الساعات الأسبوعية الموحدة: {mergePlan.plan.new_weekly_hours}
                    </Text>
                  </View>
                )}
                {mergePlan?.error && <Text style={{ color: '#c62828', fontSize: 12, textAlign: 'right', marginTop: 6 }} testID="merge-error">{mergePlan.error}</Text>}
              </ScrollView>
              <View style={{ flexDirection: 'row-reverse', gap: 8, marginTop: 12 }}>
                {!mergePlan || mergePlan.error ? (
                  <TouchableOpacity style={{ flex: 1, backgroundColor: '#7b1fa2', borderRadius: 10, padding: 12, alignItems: 'center' }} disabled={merging}
                    onPress={async () => {
                      setMerging(true);
                      try {
                        const r = await api.post('/courses-tools/merge-shared', { course_ids: mergeSel, primary_id: mergePrimary, dry_run: true });
                        setMergePlan(r.data);
                      } catch (e: any) { setMergePlan({ error: e?.response?.data?.detail || 'فشلت المعاينة' }); }
                      finally { setMerging(false); }
                    }}
                    testID="merge-preview-btn"
                  >
                    {merging ? <ActivityIndicator size="small" color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>معاينة الدمج</Text>}
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={{ flex: 1, backgroundColor: '#2e7d32', borderRadius: 10, padding: 12, alignItems: 'center' }} disabled={merging}
                    onPress={async () => {
                      if (Platform.OS === 'web' && !window.confirm('تنفيذ الدمج الآن؟ ستُحذف المقررات الثانوية بعد نقل كل بياناتها للمقرر الأساسي.')) return;
                      setMerging(true);
                      try {
                        const r = await api.post('/courses-tools/merge-shared', { course_ids: mergeSel, primary_id: mergePrimary, dry_run: false });
                        if (Platform.OS === 'web') window.alert(r.data.message);
                        setMergeModal(false); setMergeSel([]); setMergePlan(null);
                        setSelectedIds(new Set()); setSelectionMode(false);
                        fetchCourses(filterDept);
                      } catch (e: any) {
                        setMergePlan({ error: e?.response?.data?.detail || 'فشل الدمج' });
                      } finally { setMerging(false); }
                    }}
                    testID="merge-confirm-btn"
                  >
                    {merging ? <ActivityIndicator size="small" color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>✅ تأكيد الدمج</Text>}
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={{ paddingHorizontal: 16, justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: '#e3e9f2' }} onPress={() => setMergeModal(false)} testID="merge-cancel-btn">
                  <Text style={{ color: '#5b6678', fontSize: 12.5 }}>إلغاء</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* 🔍 نافذة تفاصيل المشاركة */}
      {sharedDetailCourse && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setSharedDetailCourse(null)}>
          <View style={styles.modalOverlay}>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setSharedDetailCourse(null)} />
            <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 18, width: '92%', maxWidth: 560, maxHeight: '85%' }} testID="shared-details-modal">
              <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <Text style={{ fontSize: 15, fontWeight: '800', color: '#1a2540' }}>🔗 تفاصيل المشاركة — {sharedDetailCourse.name}</Text>
                <TouchableOpacity onPress={() => setSharedDetailCourse(null)} testID="shared-details-close"><Ionicons name="close" size={20} color="#5b6678" /></TouchableOpacity>
              </View>
              {!sharedDetailData ? (
                <ActivityIndicator size="small" color="#00695c" style={{ marginVertical: 24 }} />
              ) : sharedDetailData.error ? (
                <Text style={{ color: '#f44336', textAlign: 'center', marginVertical: 20 }}>فشل في جلب التفاصيل</Text>
              ) : (
                <ScrollView style={{ maxHeight: 480 }}>
                  <Text style={{ fontSize: 11.5, color: '#5b6678', textAlign: 'right', marginBottom: 10, lineHeight: 18 }}>
                    كل بطاقة أدناه تمثل قسماً/مستوى يظهر فيه المقرر، مع المحاضرات الفعلية في الجدول التي تدعم ذلك — المشاركة تنشأ فقط من محاضرات مشتركة حقيقية (نفس الأستاذ والقاعة والوقت).
                  </Text>
                  {(sharedDetailData.groups || []).map((g: any, gi: number) => (
                    <View key={gi} style={{ borderWidth: 1, borderColor: g.is_native ? '#c8e6c9' : '#b2dfdb', backgroundColor: g.is_native ? '#f6fbf6' : '#f2fbfa', borderRadius: 10, padding: 10, marginBottom: 8 }} testID={`shared-group-${gi}`}>
                      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <Text style={{ fontSize: 13, fontWeight: '800', color: '#1a2540' }}>{g.department_name || '—'}</Text>
                        <Text style={{ fontSize: 11.5, color: '#5b6678' }}>المستوى {g.level}{g.section ? ` · شعبة ${g.section}` : ''}</Text>
                        <View style={{ backgroundColor: g.is_native ? '#2e7d32' : '#00695c', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                          <Text style={{ fontSize: 9, color: '#fff', fontWeight: '800' }}>{g.is_native ? 'القسم الأصلي' : 'مشاركة'}</Text>
                        </View>
                        {!g.is_native && (
                          <TouchableOpacity
                            style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: '#ef9a9a', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}
                            testID={`unmerge-group-${gi}`}
                            onPress={async () => {
                              if (Platform.OS === 'web' && !window.confirm(`فك هذا الموقع (م${g.level}${g.section ? '/' + g.section : ''}) إلى مقرر مستقل بخاناته وطلابه؟`)) return;
                              try {
                                const r = await api.post('/courses-tools/unmerge-shared', {
                                  course_id: sharedDetailData.course.id,
                                  link: { department_id: g.department_id, level: g.level, section: g.section || '' },
                                });
                                if (Platform.OS === 'web') window.alert(r.data.message);
                                setSharedDetailCourse(null);
                                fetchCourses(filterDept);
                              } catch (e: any) {
                                if (Platform.OS === 'web') window.alert(e?.response?.data?.detail || 'فشل فك الدمج');
                              }
                            }}
                          >
                            <Text style={{ fontSize: 9.5, color: '#c62828', fontWeight: '800' }}>↩️ فك الدمج</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                      {(g.slots || []).map((s: any, si: number) => (
                        <Text key={si} style={{ fontSize: 11.5, color: '#37455c', textAlign: 'right', lineHeight: 20 }}>
                          • {s.day} — {s.slot_name || `الفترة ${s.slot_number}`}{s.start_time ? ` (${s.start_time}-${s.end_time})` : ''} · {s.room_name || 'بدون قاعة'} · {s.teacher_name || 'بدون أستاذ'}
                        </Text>
                      ))}
                      {(!g.slots || g.slots.length === 0) && <Text style={{ fontSize: 11.5, color: '#8a95a8', textAlign: 'right' }}>لا محاضرات</Text>}
                    </View>
                  ))}
                  {(sharedDetailData.orphan_links || []).length > 0 && (
                    <View style={{ borderWidth: 1, borderColor: '#ffcdd2', backgroundColor: '#fff5f5', borderRadius: 10, padding: 10 }} testID="shared-orphan-links">
                      <Text style={{ fontSize: 12.5, fontWeight: '800', color: '#c62828', textAlign: 'right', marginBottom: 4 }}>⚠️ روابط بلا محاضرات داعمة (يتيمة)</Text>
                      {sharedDetailData.orphan_links.map((l: any, li: number) => (
                        <Text key={li} style={{ fontSize: 11.5, color: '#b71c1c', textAlign: 'right' }}>• {l.department_name || l.department_id} — المستوى {l.level}{l.section ? ` · شعبة ${l.section}` : ''}</Text>
                      ))}
                      <Text style={{ fontSize: 10.5, color: '#8a95a8', textAlign: 'right', marginTop: 4 }}>استخدم «فحص سلامة المشاركات» من قائمة المزيد لإزالتها.</Text>
                    </View>
                  )}
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>
      )}

      {/* 🩺 نافذة فحص سلامة المشاركات */}
      {integrityOpen && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setIntegrityOpen(false)}>
          <View style={styles.modalOverlay}>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setIntegrityOpen(false)} />
            <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 18, width: '92%', maxWidth: 560, maxHeight: '85%' }} testID="integrity-modal">
              <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <Text style={{ fontSize: 15, fontWeight: '800', color: '#1a2540' }}>🩺 فحص سلامة المشاركات</Text>
                <TouchableOpacity onPress={() => setIntegrityOpen(false)} testID="integrity-close"><Ionicons name="close" size={20} color="#5b6678" /></TouchableOpacity>
              </View>
              {!integrityData ? (
                <ActivityIndicator size="small" color="#00695c" style={{ marginVertical: 24 }} />
              ) : integrityData.error ? (
                <Text style={{ color: '#f44336', textAlign: 'center', marginVertical: 20 }}>فشل الفحص</Text>
              ) : (
                <ScrollView style={{ maxHeight: 440 }}>
                  <Text style={{ fontSize: 12.5, color: '#37455c', textAlign: 'right', marginBottom: 10 }} testID="integrity-summary">
                    فُحص {integrityData.checked_courses} مقرر مشترك ({integrityData.checked_links} رابطة) — {integrityData.orphan_links.length === 0 ? '✅ كل الروابط تدعمها محاضرات حقيقية في الجدول' : `⚠️ ${integrityData.orphan_links.length} رابطة يتيمة بلا محاضرات`}
                  </Text>
                  {integrityData.orphan_links.map((o: any, oi: number) => (
                    <View key={oi} style={{ borderWidth: 1, borderColor: '#ffcdd2', backgroundColor: '#fff5f5', borderRadius: 10, padding: 10, marginBottom: 6 }}>
                      <Text style={{ fontSize: 12.5, fontWeight: '800', color: '#1a2540', textAlign: 'right' }}>{o.course_name} <Text style={{ fontSize: 10.5, color: '#8a95a8' }}>({o.course_code})</Text></Text>
                      <Text style={{ fontSize: 11.5, color: '#b71c1c', textAlign: 'right', marginTop: 2 }}>رابطة يتيمة: {o.link_department_name || o.link_department_id} — المستوى {o.link_level}{o.link_section ? ` · شعبة ${o.link_section}` : ''}</Text>
                      <Text style={{ fontSize: 10.5, color: '#5b6678', textAlign: 'right' }}>القسم الأصلي: {o.own_department_name} — المستوى {o.own_level}</Text>
                    </View>
                  ))}
                </ScrollView>
              )}
              {integrityData && !integrityData.error && integrityData.orphan_links.length > 0 && (
                <TouchableOpacity
                  style={{ backgroundColor: '#c62828', borderRadius: 10, padding: 12, alignItems: 'center', marginTop: 10 }}
                  disabled={fixingLinks}
                  testID="integrity-fix-btn"
                  onPress={async () => {
                    if (Platform.OS === 'web' && !window.confirm('إزالة الروابط اليتيمة بإعادة مزامنتها من خانات الجدول الفعلية؟')) return;
                    setFixingLinks(true);
                    try {
                      const r = await api.post('/courses-tools/shared-links-integrity/fix');
                      if (Platform.OS === 'web') window.alert(r.data.message); else Alert.alert('تم', r.data.message);
                      const re = await api.get('/courses-tools/shared-links-integrity');
                      setIntegrityData(re.data);
                      fetchCourses(filterDept);
                    } catch {
                      if (Platform.OS === 'web') window.alert('فشل الإصلاح');
                    } finally { setFixingLinks(false); }
                  }}
                >
                  {fixingLinks ? <ActivityIndicator size="small" color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>إزالة الروابط اليتيمة (إعادة مزامنة من الجدول)</Text>}
                </TouchableOpacity>
              )}
            </View>
          </View>
        </Modal>
      )}

      {/* نافذة الحذف الآمن */}
      <Modal visible={showDeleteModal} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 24, width: '90%', maxWidth: 420 }}>
            <Ionicons name="warning" size={40} color="#f44336" style={{ alignSelf: 'center', marginBottom: 12 }} />
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#333', textAlign: 'center', marginBottom: 8 }}>
              حذف المقرر
            </Text>
            <Text style={{ fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 16 }}>
              "{deleteTarget?.name}"
            </Text>
            
            {deleteInfo && !deleteInfo.error ? (
              <View style={{ backgroundColor: '#fff3e0', padding: 14, borderRadius: 10, marginBottom: 16 }}>
                <Text style={{ fontSize: 13, color: '#e65100', fontWeight: '600', marginBottom: 8, textAlign: 'center' }}>
                  سيتم حذف التالي نهائياً:
                </Text>
                <Text style={{ fontSize: 13, color: '#555', lineHeight: 24 }}>
                  {`• ${deleteInfo.enrollments_count} تسجيل طالب\n• ${deleteInfo.lectures_count} محاضرة\n• ${deleteInfo.attendance_count} سجل حضور`}
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
                onPress={() => { setShowDeleteModal(false); setDeleteTarget(null); }}
              >
                <Text style={{ color: '#666', fontWeight: '600' }}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: '#f44336', padding: 14, borderRadius: 10, alignItems: 'center' }}
                onPress={confirmSafeDelete}
                disabled={deletingCourse || !deleteInfo || deleteInfo.error}
              >
                {deletingCourse ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={{ color: '#fff', fontWeight: '700' }}>حذف نهائي</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* نافذة استيراد المقررات */}
      <Modal
        visible={showImportModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowImportModal(false)}
      >
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 24, width: '90%', maxWidth: 500 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#333' }}>استيراد مقررات من Excel</Text>
              <TouchableOpacity onPress={() => setShowImportModal(false)}>
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>

            {/* اختيار القسم */}
            <Text style={{ fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 8 }}>القسم *</Text>
            {Platform.OS === 'web' ? (
              <select
                value={selectedDeptForImport}
                onChange={(e: any) => setSelectedDeptForImport(e.target.value)}
                data-testid="import-dept-select"
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 8,
                  border: '1px solid #ddd', fontSize: 14, marginBottom: 16,
                  backgroundColor: '#f9f9f9',
                }}
              >
                <option value="">-- اختر القسم --</option>
                {departments.map(dept => (
                  <option key={dept.id} value={dept.id}>{dept.name}</option>
                ))}
              </select>
            ) : null}

            {/* أزرار */}
            <View style={{ gap: 12 }}>
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#e8f5e9', padding: 14, borderRadius: 10 }}
                onPress={handleDownloadTemplate}
              >
                <Ionicons name="download" size={20} color="#2e7d32" />
                <Text style={{ color: '#2e7d32', fontSize: 15, fontWeight: '600' }}>تحميل نموذج Excel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: importing ? '#e0e0e0' : '#1565c0', padding: 14, borderRadius: 10 }}
                onPress={handleImportCourses}
                disabled={importing}
                data-testid="import-courses-submit-btn"
              >
                {importing ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="cloud-upload" size={20} color="#fff" />
                )}
                <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>
                  {importing ? 'جاري الاستيراد...' : 'رفع ملف Excel'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* نتيجة الاستيراد */}
            {importResult && (
              <View style={{ marginTop: 16, padding: 12, backgroundColor: importResult.imported > 0 ? '#e8f5e9' : '#ffebee', borderRadius: 8 }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: importResult.imported > 0 ? '#2e7d32' : '#c62828' }}>
                  {importResult.message}
                </Text>
                {importResult.errors?.length > 0 && (
                  <View style={{ marginTop: 8 }}>
                    {importResult.errors.slice(0, 5).map((err: string, i: number) => (
                      <Text key={i} style={{ fontSize: 12, color: '#c62828', marginTop: 2 }}>{err}</Text>
                    ))}
                    {importResult.total_errors > 5 && (
                      <Text style={{ fontSize: 12, color: '#666', marginTop: 4 }}>و {importResult.total_errors - 5} أخطاء أخرى...</Text>
                    )}
                  </View>
                )}
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* نافذة استيراد المحاضرات */}
      <Modal
        visible={showImportLecturesModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowImportLecturesModal(false)}
      >
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 24, width: '90%', maxWidth: 500 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#333' }}>استيراد محاضرات من Excel</Text>
              <TouchableOpacity onPress={() => setShowImportLecturesModal(false)}>
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>

            <View style={{ backgroundColor: '#fff3e0', borderRadius: 8, padding: 12, marginBottom: 16 }}>
              <Text style={{ fontSize: 13, color: '#e65100', fontWeight: '600', marginBottom: 4 }}>متطلبات قبل الاستيراد:</Text>
              <Text style={{ fontSize: 12, color: '#666' }}>1. يجب أن تكون المقررات موجودة في النظام مسبقاً</Text>
              <Text style={{ fontSize: 12, color: '#666' }}>2. كل مقرر يجب أن يكون له معلم معيّن</Text>
              <Text style={{ fontSize: 12, color: '#666' }}>3. استخدم رمز المقرر (Code) الموجود في النظام</Text>
            </View>

            <View style={{ gap: 12 }}>
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#f3e5f5', padding: 14, borderRadius: 10 }}
                onPress={handleDownloadLecturesTemplate}
                data-testid="download-lectures-template-modal-btn"
              >
                <Ionicons name="download" size={20} color="#6a1b9a" />
                <Text style={{ color: '#6a1b9a', fontSize: 15, fontWeight: '600' }}>تحميل نموذج المحاضرات</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: importingLectures ? '#e0e0e0' : '#e65100', padding: 14, borderRadius: 10 }}
                onPress={handleImportLectures}
                disabled={importingLectures}
                data-testid="import-lectures-submit-btn"
              >
                {importingLectures ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="cloud-upload" size={20} color="#fff" />
                )}
                <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>
                  {importingLectures ? 'جاري الاستيراد...' : 'رفع ملف المحاضرات'}
                </Text>
              </TouchableOpacity>
            </View>

            {importLecturesResult && (
              <View style={{ marginTop: 16, padding: 12, backgroundColor: importLecturesResult.imported > 0 ? '#e8f5e9' : '#ffebee', borderRadius: 8 }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: importLecturesResult.imported > 0 ? '#2e7d32' : '#c62828' }}>
                  {importLecturesResult.message}
                </Text>
                {importLecturesResult.imported > 0 && (
                  <View style={{ flexDirection: 'row', gap: 16, marginTop: 8 }}>
                    <Text style={{ fontSize: 13, color: '#2e7d32' }}>محاضرات: {importLecturesResult.imported}</Text>
                    <Text style={{ fontSize: 13, color: '#1565c0' }}>مقررات: {importLecturesResult.courses_count}</Text>
                    {importLecturesResult.conflicts_skipped > 0 && (
                      <Text style={{ fontSize: 13, color: '#e65100' }}>تعارضات: {importLecturesResult.conflicts_skipped}</Text>
                    )}
                  </View>
                )}
                {importLecturesResult.errors?.length > 0 && (
                  <View style={{ marginTop: 8 }}>
                    {importLecturesResult.errors.slice(0, 5).map((err: string, i: number) => (
                      <Text key={i} style={{ fontSize: 12, color: '#c62828', marginTop: 2 }}>{err}</Text>
                    ))}
                    {importLecturesResult.total_errors > 5 && (
                      <Text style={{ fontSize: 12, color: '#666', marginTop: 4 }}>و {importLecturesResult.total_errors - 5} تنبيهات أخرى...</Text>
                    )}
                  </View>
                )}
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* 🔧 مودال إسناد سريع لمعلم - مباشرة من صف المقرر */}
      <AssignTeacherModal
        visible={!!assignTeacherCourse}
        onClose={() => setAssignTeacherCourse(null)}
        courseId={assignTeacherCourse?.id || ''}
        courseName={assignTeacherCourse?.name}
        courseDepartmentId={assignTeacherCourse?.department_id}
        courseCode={assignTeacherCourse?.code}
        courseLevel={assignTeacherCourse?.level}
        courseSection={assignTeacherCourse?.section}
        currentTeacherId={assignTeacherCourse?.teacher_id || ''}
        teachers={teachers}
        departments={departments}
        faculties={faculties}
        onSaved={(newTeacherId, name) => {
          // تحديث محلي للقائمة فوراً
          setCourses(prev => prev.map(c =>
            c.id === assignTeacherCourse?.id
              ? { ...c, teacher_id: newTeacherId || '', teacher_name: name || '' }
              : c
          ));
        }}
      />

      {/* 🔧 مودال اختيار معلم في النموذج (بحث + قسم) — formMode */}
      <AssignTeacherModal
        visible={showFormTeacherPicker}
        onClose={() => setShowFormTeacherPicker(false)}
        courseId={editingCourse?.id || ''}
        courseName={formData.name}
        courseDepartmentId={formData.department_id}
        courseCode={formData.code}
        courseLevel={formData.level}
        courseSection={formData.section}
        currentTeacherId={formData.teacher_id}
        teachers={teachers}
        departments={departments}
        faculties={faculties}
        formMode
        onSaved={(newTeacherId) => {
          setFormData({ ...formData, teacher_id: newTeacherId || '' });
        }}
      />

      {/* 🔧 مودال الإسناد الجماعي — لـ selectedIds */}
      <AssignTeacherModal
        visible={showBulkAssign}
        onClose={() => {
          // عند الإغلاق: ننظّف وضع التحديد ونغلق المودال
          setShowBulkAssign(false);
          setSelectedIds(new Set());
          setSelectionMode(false);
        }}
        courseId=""
        teachers={teachers}
        departments={departments}
        faculties={faculties}
        bulkCourses={Array.from(selectedIds).map(id => {
          const c = courses.find(cc => cc.id === id);
          if (!c) return null;
          const tname = teachers.find(t => t.id === c.teacher_id)?.full_name || '';
          return {
            id: c.id,
            name: c.name,
            code: c.code,
            credit_hours: (c as any).credit_hours ?? 3,
            department_id: c.department_id,
            current_teacher_id: c.teacher_id || undefined,
            current_teacher_name: tname,
            level: c.level,
            section: c.section,
          };
        }).filter(Boolean) as any}
        teacherCurrentLoadMap={teacherLoadMap}
        onSaved={() => {}}
        onBulkSaved={(newTeacherId, name, results) => {
          // تحديث محلي للجدول للمقررات التي نجحت — بدون مسح selectedIds
          // (نتركها للمستخدم ليرى النتائج ثم يغلق المودال)
          const okIds = new Set(results.filter(r => r.ok).map(r => r.course_id));
          if (okIds.size > 0) {
            setCourses(prev => prev.map(c =>
              okIds.has(c.id)
                ? { ...c, teacher_id: newTeacherId || '', teacher_name: name || '' }
                : c
            ));
          }
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f4f6fb',
  },

  // ====== التصميم الجديد ======
  pageScroll: { padding: 20, paddingBottom: 60, maxWidth: 1440, width: '100%', alignSelf: 'center' },
  pageHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 12 },
  pageHeaderRight: { alignItems: 'flex-end' },
  pageTitle: { fontSize: 26, fontWeight: '700', color: '#1a2540', textAlign: 'right', marginBottom: 6 },
  breadcrumb: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  breadcrumbLink: { fontSize: 13, color: '#2962ff', fontWeight: '500' },
  breadcrumbCurrent: { fontSize: 13, color: '#8a95a8', fontWeight: '500' },
  semesterBadge: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12, backgroundColor: '#e3f2fd', marginTop: 6, alignSelf: 'flex-end' },
  semesterBadgeText: { fontSize: 11, color: '#1565c0', fontWeight: '700' },
  pageHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  headerBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 8 },
  btnPrimary: { backgroundColor: '#2962ff' },
  btnPrimaryText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  btnSuccess: { backgroundColor: '#22c55e' },
  btnGhost: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e3e7ee' },
  btnGhostText: { color: '#1a2540', fontSize: 13, fontWeight: '600' },

  statsGrid: { flexDirection: 'row', gap: 14, marginBottom: 18, flexWrap: 'wrap' },
  statCard: { flex: 1, minWidth: 200, backgroundColor: '#fff', borderRadius: 14, padding: 18, flexDirection: 'row-reverse', alignItems: 'center', gap: 14, borderWidth: 1, borderColor: '#eef1f6' },
  statIconWrap: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  statTextCol: { flex: 1, alignItems: 'flex-end' },
  statLabel: { fontSize: 13, color: '#8a95a8', fontWeight: '500', marginBottom: 4 },
  statValue: { fontSize: 22, color: '#1a2540', fontWeight: '700', marginBottom: 2 },
  statSubLabel: { fontSize: 11, color: '#a8b1c2' },

  filterCard: { backgroundColor: '#fff', borderRadius: 14, padding: 18, marginBottom: 18, borderWidth: 1, borderColor: '#eef1f6' },
  filterRow: { flexDirection: 'row-reverse', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' },
  filterField: { flex: 1, minWidth: 140 },
  filterLbl: { fontSize: 12, color: '#5b6678', fontWeight: '500', marginBottom: 5, textAlign: 'right' },
  searchBox: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: '#e3e7ee', height: 40 },
  searchBoxInput: { flex: 1, fontSize: 13, color: '#1a2540', textAlign: 'right', outlineStyle: 'none' as any },
  dropdown: { backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#e3e7ee', height: 40, overflow: 'hidden', justifyContent: 'center' },
  dropdownInner: { height: 40, fontSize: 13, color: '#1a2540', textAlign: 'right', backgroundColor: 'transparent', borderWidth: 0 },
  filterBtns: { flexDirection: 'row-reverse', alignItems: 'center', gap: 14 },
  resetBtn: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, paddingVertical: 9, paddingHorizontal: 4 },
  resetBtnText: { fontSize: 13, color: '#2962ff', fontWeight: '600' },

  tableCard: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#eef1f6' },
  tableCardHeader: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#eef1f6' },
  tableCardTitle: { fontSize: 15, fontWeight: '700', color: '#1a2540' },
  tableCardCount: { fontSize: 12, color: '#5b6678' },
  tableCardCountAccent: { color: '#2962ff', fontWeight: '700' },
  tableHeaderRow: { flexDirection: 'row-reverse', alignItems: 'center', backgroundColor: '#fafbfd', borderBottomWidth: 1, borderBottomColor: '#eef1f6', minHeight: 44 },
  thText: { fontSize: 12, fontWeight: '600', color: '#5b6678', textAlign: 'right' },
  tRow: { flexDirection: 'row-reverse', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#f3f5f9', minHeight: 60 },
  tRowAlt: { backgroundColor: '#fcfcfd' },
  tRowSelected: { backgroundColor: '#eef4ff' },
  cellPad: { paddingVertical: 12, paddingHorizontal: 14 },
  cCol1: { flex: 2.5, flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  cCol2: { flex: 1.5 },
  cCol3: { flex: 0.7 },
  cCol4: { flex: 1.5 },
  cCol5: { flex: 0.8 },
  cCol6: { flex: 0.8 },
  cCol7: { flex: 0.7, alignItems: 'flex-start' },
  bookAvatar: { width: 36, height: 36, borderRadius: 8, backgroundColor: '#e7f0fe', alignItems: 'center', justifyContent: 'center' },
  rowCheckbox: { width: 32, alignItems: 'center', justifyContent: 'center' },
  tName: { fontSize: 13, fontWeight: '600', color: '#1a2540', textAlign: 'right' },
  tSubName: { fontSize: 11, color: '#8a95a8', textAlign: 'right', marginTop: 2 },
  tCell: { fontSize: 13, color: '#1a2540', textAlign: 'right' },
  levelChip: { alignSelf: 'flex-end', backgroundColor: '#eef4ff', color: '#2962ff', fontSize: 12, fontWeight: '700', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, overflow: 'hidden' },
  statChip: { alignSelf: 'flex-end', flexDirection: 'row-reverse', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  statChipText: { fontSize: 12, fontWeight: '700' },
  dotsBtn: { width: 32, height: 32, borderRadius: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#e3e7ee', backgroundColor: '#fff' },
  teacherChipRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, paddingVertical: 4, paddingHorizontal: 6, borderRadius: 6, alignSelf: 'flex-end' },
  teacherChipText: { fontSize: 13, color: '#1a2540', fontWeight: '600', maxWidth: 110 },
  assignTeacherBtn: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: '#2962ff', alignSelf: 'flex-end' },
  assignTeacherBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  teacherPickerButton: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, padding: 12, borderWidth: 1, borderColor: '#e3e7ee', backgroundColor: '#f8fafc', borderRadius: 8, marginBottom: 12 },
  teacherPickerName: { fontSize: 14, color: '#1a2540', fontWeight: '700', textAlign: 'right' },
  teacherPickerHint: { fontSize: 11, color: '#5b6678', marginTop: 2, textAlign: 'right' },
  teacherPickerPlaceholder: { fontSize: 13, color: '#8a95a8', textAlign: 'right' },
  tableEmpty: { paddingVertical: 60, alignItems: 'center', gap: 12 },
  tableEmptyText: { fontSize: 14, color: '#8a95a8' },
  tableFooter: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderTopWidth: 1, borderTopColor: '#eef1f6', flexWrap: 'wrap', gap: 12 },
  perPageWrap: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  perPageLbl: { fontSize: 12, color: '#5b6678' },
  perPageBox: { width: 70, height: 34, borderWidth: 1, borderColor: '#e3e7ee', borderRadius: 6, justifyContent: 'center', overflow: 'hidden' },
  perPagePicker: { height: 34, fontSize: 12, borderWidth: 0, backgroundColor: 'transparent' },
  pagerWrap: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  pagerBtn: { minWidth: 32, height: 32, borderRadius: 6, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#e3e7ee', backgroundColor: '#fff' },
  pagerBtnActive: { backgroundColor: '#2962ff', borderColor: '#2962ff' },
  pagerBtnText: { fontSize: 12, color: '#1a2540', fontWeight: '600' },
  pagerBtnTextActive: { color: '#fff' },
  pagerDots: { color: '#8a95a8', paddingHorizontal: 4 },
  pagerNavBtn: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, paddingHorizontal: 12, height: 32, borderRadius: 6, borderWidth: 1, borderColor: '#e3e7ee', backgroundColor: '#fff' },
  pagerNavBtnDisabled: { backgroundColor: '#fafbfd' },
  pagerNavText: { fontSize: 12, color: '#1a2540', fontWeight: '600' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(20,30,55,0.45)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  menuModalCard: { backgroundColor: '#fff', borderRadius: 14, width: '100%', maxWidth: 380, paddingVertical: 8, borderWidth: 1, borderColor: '#eef1f6', boxShadow: '0 12px 32px rgba(20,30,55,0.18)' as any },
  menuModalHeader: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f3f5f9', marginBottom: 4 },
  menuModalTitle: { fontSize: 14, fontWeight: '700', color: '#1a2540', flex: 1, textAlign: 'right' },
  menuItem: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 14 },
  menuItemDanger: { borderTopWidth: 1, borderTopColor: '#f3f5f9', marginTop: 2 },
  menuText: { fontSize: 13, color: '#1a2540', fontWeight: '500', textAlign: 'right' },

  // ====== الستايلات القديمة (لا تزال مستخدمة في النموذج والـ modals) ======
  addButton: {
    flexDirection: 'row',
    backgroundColor: '#ff9800',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  addButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 15,
    color: '#333',
  },
  filterContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  filterBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderRadius: 20,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  filterBtnActive: {
    backgroundColor: '#ff9800',
    borderColor: '#ff9800',
  },
  filterText: {
    fontSize: 13,
    color: '#333',
  },
  filterTextActive: {
    color: '#fff',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  itemCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  itemInfo: {
    flex: 1,
    gap: 2,
  },
  courseTopRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: 6,
  },
  courseMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  itemMutedSm: {
    fontSize: 11,
    color: '#777',
  },
  courseStatChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  courseStatChipBlue: {
    fontSize: 11,
    color: '#1565c0',
    fontWeight: '700',
  },
  courseStatChipOrange: {
    fontSize: 11,
    color: '#e65100',
    fontWeight: '700',
  },
  itemName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#222',
  },
  itemDetail: {
    fontSize: 11,
    color: '#666',
  },
  deleteBtn: {
    padding: 6,
  },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  editBtn: {
    padding: 6,
    backgroundColor: '#fff3e0',
    borderRadius: 6,
  },
  studentsBtn: {
    padding: 6,
    backgroundColor: '#e3f2fd',
    borderRadius: 6,
  },
  lecturesBtn: {
    padding: 6,
    backgroundColor: '#f3e5f5',
    borderRadius: 6,
  },
  studyPlanBtn: {
    padding: 6,
    backgroundColor: '#e8f5e9',
    borderRadius: 6,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 60,
  },
  semesterInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e3f2fd',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    gap: 8,
  },
  semesterInfoText: {
    flex: 1,
    fontSize: 13,
    color: '#1565c0',
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
    marginTop: 16,
  },
  formContainer: {
    padding: 16,
  },
  formCardModern: { backgroundColor: '#fff', borderRadius: 14, padding: 22, borderWidth: 1, borderColor: '#eef1f6', maxWidth: 800, alignSelf: 'center', width: '100%' },
  formHeaderModern: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#f3f5f9' },
  formTitleModern: { fontSize: 22, fontWeight: '700', color: '#1a2540', textAlign: 'right', marginBottom: 6 },
  formCloseBtnModern: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f4f6fb' },
  formTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 20,
    textAlign: 'center',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
    marginTop: 12,
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    textAlign: 'right',
  },
  pickerWrapper: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    overflow: 'hidden',
    marginBottom: 8,
  },
  picker: {
    height: 50,
  },
  optionsRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  optionBtn: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  optionBtnActive: {
    backgroundColor: '#1565c0',
    borderColor: '#1565c0',
  },
  optionText: {
    fontSize: 14,
    color: '#666',
  },
  optionTextActive: {
    color: '#fff',
  },
  formButtons: {
    flexDirection: 'row',
    marginTop: 24,
    marginBottom: 40,
  },
  btn: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  cancelBtn: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    marginRight: 8,
  },
  cancelBtnText: {
    color: '#666',
    fontSize: 16,
    fontWeight: '600',
  },
  saveBtn: {
    backgroundColor: '#4caf50',
    marginLeft: 8,
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  // Bulk action styles
  actionsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 12,
  },
  selectButton: {
    backgroundColor: '#9c27b0',
    flex: 0,
    paddingHorizontal: 20,
    margin: 0,
  },
  bulkActionBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff3e0',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#ffcc80',
    zIndex: 999,
    position: 'relative',
  },
  bulkActionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bulkActionClose: {
    marginRight: 12,
  },
  bulkActionText: {
    fontSize: 15,
    color: '#333',
    fontWeight: '600',
  },
  bulkActionRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bulkActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ff9800',
    gap: 4,
  },
  bulkActionBtnText: {
    fontSize: 13,
    color: '#ff9800',
    fontWeight: '600',
  },
  bulkDeleteBtn: {
    backgroundColor: '#f44336',
    borderColor: '#f44336',
  },
  bulkDeleteBtnText: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '600',
  },
  checkbox: {
    marginRight: 12,
    padding: 4,
  },
  itemCardSelected: {
    backgroundColor: '#fff8e1',
    borderWidth: 1,
    borderColor: '#ff9800',
  },
  pagination: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 16,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  pageBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#e3f2fd',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pageBtnDisabled: {
    backgroundColor: '#f5f5f5',
  },
  pageText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  pageInfo: {
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  pageInfoText: {
    fontSize: 12,
    color: '#888',
    fontWeight: '500',
  },
});
