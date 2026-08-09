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
  Modal,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Picker } from '@react-native-picker/picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { teachersAPI, departmentsAPI } from '../src/services/api';
import { API_URL } from '../src/services/api';
import { LoadingScreen } from '../src/components/LoadingScreen';
import { SortableHeader } from '../src/components/SortableHeader';

interface Teacher {
  id: string;
  teacher_id?: string;
  name?: string;
  full_name?: string;
  username?: string;
  department_id?: string;
  department_ids?: string[];
  department_names?: string[];
  email?: string;
  phone?: string;
  specialization?: string;
  academic_title?: string;
  teaching_load?: number;
  weekly_hours?: number;
  courses_count?: number;
  current_semester_id?: string | null;
  current_semester_name?: string;
  current_semester_hours?: number;
  current_semester_courses_count?: number;
  user_id?: string;
  is_active: boolean;
}

interface Department {
  id: string;
  name: string;
}

export default function ManageTeachersScreen() {
  const router = useRouter();
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingTeacher, setEditingTeacher] = useState<Teacher | null>(null);
  const [filterDepartment, setFilterDepartment] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');

  // قائمة العمليات (3 نقاط)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [perPage, setPerPage] = useState(10);
  const [sortBy, setSortBy] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    teacher_id: '',
    full_name: '',
    department_ids: [] as string[],
    email: '',
    phone: '',
    specialization: '',
    academic_title: '',
    teaching_load: '',
    weekly_hours: '12',
  });

  // حذف آمن
  const [deleteTarget, setDeleteTarget] = useState<Teacher | null>(null);
  const [deleteInfo, setDeleteInfo] = useState<any>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletingTeacher, setDeletingTeacher] = useState(false);
  const [restoring, setRestoring] = useState(false);

  // استيراد من Excel
  const [showImportModal, setShowImportModal] = useState(false);
  const [importDeptId, setImportDeptId] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);

  // ✅ التحديد المتعدد والإجراءات الجماعية
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState<{ action: string; label: string; danger?: boolean; needsDept?: boolean } | null>(null);
  const [bulkDeptId, setBulkDeptId] = useState('');
  const [bulkResult, setBulkResult] = useState<any>(null);

  const toggleSelect = (id: string) => setSelectedIds(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);

  const runBulkAction = async (action: string) => {
    setBulkBusy(true);
    try {
      const token = await AsyncStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/teachers/bulk-action`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, teacher_ids: selectedIds, department_id: bulkDeptId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || 'فشل تنفيذ الإجراء');
      setBulkConfirm(null);
      setBulkDeptId('');
      setBulkResult(data);
      setSelectedIds([]);
      fetchData();
    } catch (e: any) {
      showMessage('خطأ', e?.message || 'فشل تنفيذ الإجراء');
    } finally {
      setBulkBusy(false);
    }
  };

  const exportSelected = async () => {
    setBulkBusy(true);
    try {
      const token = await AsyncStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/teachers/export-selected`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacher_ids: selectedIds }),
      });
      if (!res.ok) throw new Error('فشل التصدير');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `teachers_selected_${Date.now()}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      showMessage('خطأ', e?.message || 'فشل التصدير');
    } finally {
      setBulkBusy(false);
    }
  };

  // Alert helpers for web compatibility
  const showMessage = (title: string, message: string) => {
    if (Platform.OS === 'web') {
      window.alert(`${title}\n\n${message}`);
    } else {
      Alert.alert(title, message);
    }
  };

  const showConfirm = (title: string, message: string, onConfirm: () => void, confirmText = 'تأكيد', destructive = false) => {
    if (Platform.OS === 'web') {
      if (window.confirm(`${title}\n\n${message}`)) {
        onConfirm();
      }
    } else {
      Alert.alert(title, message, [
        { text: 'إلغاء', style: 'cancel' },
        { text: confirmText, style: destructive ? 'destructive' : 'default', onPress: onConfirm }
      ]);
    }
  };

  const fetchData = useCallback(async () => {
    try {
      // 🛡️ Promise.allSettled: لو فشل أي API (مثلاً 403)، البقية تكمل عملها
      const results = await Promise.allSettled([
        teachersAPI.getAll(),
        departmentsAPI.getAll(),
      ]);
      const [teachersRes, deptsRes] = results;
      if (teachersRes.status === 'fulfilled') {
        setTeachers(teachersRes.value.data || []);
      } else {
        console.warn('Failed to fetch teachers:', teachersRes.reason);
        setTeachers([]);
      }
      if (deptsRes.status === 'fulfilled') {
        setDepartments(deptsRes.value.data || []);
      } else {
        console.warn('Failed to fetch departments:', deptsRes.reason);
        setDepartments([]);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSubmit = async () => {
    if (!formData.teacher_id || !formData.full_name) {
      showMessage('خطأ', 'الرجاء ملء جميع الحقول المطلوبة');
      return;
    }

    setSaving(true);
    try {
      if (editingTeacher) {
        await teachersAPI.update(editingTeacher.id, {
          full_name: formData.full_name,
          department_ids: formData.department_ids.length > 0 ? formData.department_ids : undefined,
          email: formData.email || undefined,
          phone: formData.phone || undefined,
          specialization: formData.specialization || undefined,
          academic_title: formData.academic_title || undefined,
          teaching_load: formData.teaching_load ? parseInt(formData.teaching_load) : undefined,
          weekly_hours: formData.weekly_hours ? parseInt(formData.weekly_hours) : 12,
        });
        showMessage('نجاح', 'تم تحديث بيانات المعلم بنجاح');
      } else {
        await teachersAPI.create({
          ...formData,
          teaching_load: formData.teaching_load ? parseInt(formData.teaching_load) : undefined,
          weekly_hours: formData.weekly_hours ? parseInt(formData.weekly_hours) : 12,
        });
        showMessage('نجاح', 'تم إضافة المعلم بنجاح');
      }
      resetForm();
      setShowForm(false);
      setEditingTeacher(null);
      fetchData();
    } catch (error: any) {
      const message = error.response?.data?.detail || 'حدث خطأ';
      showMessage('خطأ', message);
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setFormData({
      teacher_id: '',
      full_name: '',
      department_ids: [] as string[],
      email: '',
      phone: '',
      specialization: '',
      academic_title: '',
      teaching_load: '',
      weekly_hours: '12',
    });
  };

  // دالة مساعدة للحصول على اسم المعلم
  const getTeacherName = (teacher: Teacher) => teacher.full_name || teacher.name || 'غير معروف';
  const getTeacherId = (teacher: Teacher) => teacher.teacher_id || teacher.username || '';

  const handleEdit = (teacher: Teacher) => {
    setEditingTeacher(teacher);
    setFormData({
      teacher_id: getTeacherId(teacher),
      full_name: getTeacherName(teacher),
      department_ids: teacher.department_ids || (teacher.department_id ? [teacher.department_id] : []) as string[],
      email: teacher.email || '',
      phone: teacher.phone || '',
      specialization: teacher.specialization || '',
      academic_title: teacher.academic_title || '',
      teaching_load: teacher.teaching_load ? teacher.teaching_load.toString() : '',
      weekly_hours: teacher.weekly_hours ? teacher.weekly_hours.toString() : '12',
    });
    setShowForm(true);
  };

  const handleDelete = async (teacher: Teacher) => {
    setDeleteTarget(teacher);
    setDeleteInfo(null);
    setShowDeleteModal(true);
    
    try {
      const token = await AsyncStorage.getItem('token');
      const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
      const res = await fetch(`${API_URL}/api/teachers/${teacher.id}/backup-info`, {
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
    setDeletingTeacher(true);
    
    try {
      const token = await AsyncStorage.getItem('token');
      const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
      const res = await fetch(`${API_URL}/api/teachers/${deleteTarget.id}/safe-delete`, {
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
          a.download = `backup_teacher_${getTeacherName(deleteTarget)}_${new Date().toISOString().split('T')[0]}.json`;
          a.click();
          URL.revokeObjectURL(url);
        }
        
        showMessage('نجاح', `تم حذف "${getTeacherName(deleteTarget)}" وتنزيل النسخة الاحتياطية`);
        setShowDeleteModal(false);
        setDeleteTarget(null);
        fetchData();
      } else {
        showMessage('خطأ', data.detail || 'فشل في حذف المعلم');
      }
    } catch (error) {
      showMessage('خطأ', 'فشل في حذف المعلم');
    } finally {
      setDeletingTeacher(false);
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
        
        if (backupData.backup_type !== 'teacher_backup') {
          showMessage('خطأ', 'ملف النسخة الاحتياطية غير صالح - يجب أن يكون نسخة معلم');
          setRestoring(false);
          return;
        }
        
        const teacherName = backupData.teacher?.full_name || 'غير معروف';
        const coursesCount = backupData.teaching_load?.length || 0;
        
        if (!confirm(`استعادة المعلم "${teacherName}"?\n- ${coursesCount} مقرر`)) {
          setRestoring(false);
          return;
        }
        
        const token = await AsyncStorage.getItem('token');
        const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
        const res = await fetch(`${API_URL}/api/teachers/restore`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(backupData),
        });
        const data = await res.json();
        
        if (res.ok) {
          showMessage('نجاح', `تم استعادة "${teacherName}" بنجاح`);
          fetchData();
        } else {
          showMessage('خطأ', data.detail || 'فشل في الاستعادة');
        }
      } catch (error) {
        showMessage('خطأ', 'فشل في قراءة الملف');
      } finally {
        setRestoring(false);
      }
    };
    
    input.click();
  };

  // تنزيل نموذج Excel
  const handleDownloadTemplate = async () => {
    try {
      const res = await teachersAPI.getTemplate();
      if (Platform.OS === 'web') {
        const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'teachers_template.xlsx';
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      showMessage('خطأ', 'فشل في تنزيل النموذج');
    }
  };

  // استيراد المعلمين من Excel
  const handleImportExcel = () => {
    if (!importDeptId) {
      showMessage('خطأ', 'يجب تحديد القسم الافتراضي');
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
        
        const res = await teachersAPI.importFromExcel(formData, importDeptId);
        setImportResult(res.data);
        showMessage('تم الاستيراد', res.data.message);
        fetchData();
      } catch (error: any) {
        const msg = error.response?.data?.detail || 'فشل في استيراد الملف';
        showMessage('خطأ', msg);
        setImportResult({ error: msg });
      } finally {
        setImporting(false);
      }
    };
    
    input.click();
  };

  // تفعيل حساب المعلم
  const handleActivateAccount = (teacher: Teacher) => {
    const message = `هل تريد تفعيل حساب للمعلم ${getTeacherName(teacher)}؟\n\nبيانات الدخول:\n• اسم المستخدم: ${getTeacherId(teacher)}\n• كلمة المرور: ${getTeacherId(teacher)}\n\n⚠️ سيُطلب من المعلم تغيير كلمة المرور عند أول دخول`;
    
    showConfirm('تفعيل حساب', message, async () => {
      try {
        setSaving(true);
        const response = await teachersAPI.activateAccount(teacher.id);
        showMessage('تم التفعيل بنجاح ✅', `تم تفعيل حساب المعلم\n\nاسم المستخدم: ${response.data.username}\nكلمة المرور: ${getTeacherId(teacher)}`);
        fetchData();
      } catch (error: any) {
        const errorMsg = error.response?.data?.detail || 'فشل في تفعيل الحساب';
        showMessage('خطأ', errorMsg);
      } finally {
        setSaving(false);
      }
    }, 'تفعيل');
  };

  // إلغاء تفعيل حساب المعلم
  const handleDeactivateAccount = async (teacher: Teacher) => {
    const message = `هل أنت متأكد من إلغاء تفعيل حساب ${getTeacherName(teacher)}؟\n\nلن يتمكن المعلم من الدخول للنظام بعد ذلك.`;
    
    showConfirm('إلغاء تفعيل الحساب', message, async () => {
      try {
        setSaving(true);
        await teachersAPI.deactivateAccount(teacher.id);
        showMessage('تم', 'تم إلغاء تفعيل حساب المعلم');
        fetchData();
      } catch (error: any) {
        const errorMsg = error.response?.data?.detail || 'فشل في إلغاء التفعيل';
        showMessage('خطأ', errorMsg);
      } finally {
        setSaving(false);
      }
    }, 'إلغاء التفعيل', true);
  };

  // إعادة تعيين كلمة المرور
  const handleResetPassword = (teacher: Teacher) => {
    const message = `هل تريد إعادة تعيين كلمة مرور ${getTeacherName(teacher)}؟\n\nستصبح كلمة المرور الجديدة: ${getTeacherId(teacher)}`;
    
    showConfirm('إعادة تعيين كلمة المرور', message, async () => {
      try {
        setSaving(true);
        await teachersAPI.resetPassword(teacher.id);
        showMessage('تم ✅', `تم إعادة تعيين كلمة المرور\n\nكلمة المرور الجديدة: ${getTeacherId(teacher)}`);
      } catch (error: any) {
        const errorMsg = error.response?.data?.detail || 'فشل في إعادة تعيين كلمة المرور';
        showMessage('خطأ', errorMsg);
      } finally {
        setSaving(false);
      }
    });
  };

  const getDepartmentName = (deptId?: string) => {
    if (!deptId) return 'غير محدد';
    const dept = departments.find(d => d.id === deptId);
    return dept?.name || 'غير محدد';
  };

  // Pagination
  const PAGE_SIZE = 10;
  const [currentPage, setCurrentPage] = useState(1);

  // فلترة المعلمين
  let filteredTeachers = teachers;
  if (filterDepartment) {
    filteredTeachers = filteredTeachers.filter(t => 
      t.department_id === filterDepartment || 
      (t.department_ids && t.department_ids.includes(filterDepartment))
    );
  }
  if (searchQuery) {
    filteredTeachers = filteredTeachers.filter(t => 
      getTeacherName(t).includes(searchQuery) || 
      getTeacherId(t).includes(searchQuery)
    );
  }
  // 🔤 فرز ديناميكي
  if (sortBy) {
    filteredTeachers = [...filteredTeachers].sort((a: any, b: any) => {
      let cmp = 0;
      if (sortBy.startsWith('name_')) cmp = getTeacherName(a).localeCompare(getTeacherName(b), 'ar');
      else if (sortBy.startsWith('hours_')) cmp = ((a.weekly_hours as number) || 0) - ((b.weekly_hours as number) || 0);
      else if (sortBy.startsWith('courses_')) cmp = ((a.courses_count as number) || 0) - ((b.courses_count as number) || 0);
      return sortBy.endsWith('_desc') ? -cmp : cmp;
    });
  }

  // اسم الفصل النشط (للشارة في رأس الصفحة)
  const activeSemesterName = useMemo(
    () => teachers.find(t => t.current_semester_name)?.current_semester_name || '',
    [teachers],
  );

  const hasActiveFilter = !!filterDepartment || !!searchQuery;

  const renderTeacher = ({ item, index }: { item: Teacher; index: number }) => {
    const hasAccount = !!item.user_id;
    const teacherName = getTeacherName(item);
    const dept = getDepartmentName(item.department_id);
    // ✅ توحيد العرض: استخدام بيانات الفصل النشط (متطابقة مع صفحة /teacher-courses)
    const coursesCount = item.current_semester_courses_count ?? (item.assigned_courses?.length ?? item.courses_count ?? 0);
    const loadHours = item.current_semester_hours ?? item.weekly_hours ?? item.teaching_load ?? 0;

    return (
      <View dataSet={{ responsive: "table-row" }} style={[styles.tRow, index % 2 === 1 && styles.tRowAlt, selectedIds.includes(item.id) && { backgroundColor: '#e8f1fd' }]}>
        <TouchableOpacity
          onPress={() => toggleSelect(item.id)}
          style={{ width: 34, alignItems: 'center', justifyContent: 'center' }}
          testID={`teacher-select-${item.id}`}
        >
          <Ionicons name={selectedIds.includes(item.id) ? 'checkbox' : 'square-outline'} size={20} color={selectedIds.includes(item.id) ? '#1565c0' : '#b8c4d6'} />
        </TouchableOpacity>
        <View style={[styles.colTeacher, styles.cellPad]}>
          <View style={[styles.tAvatar, { backgroundColor: hasAccount ? '#dcedc8' : '#eceff1' }]}>
            <Text style={[styles.tAvatarText, { color: hasAccount ? '#4caf50' : '#90a4ae' }]}>{teacherName.charAt(0)}</Text>
          </View>
          <TouchableOpacity
            style={{ flex: 1 }}
            onPress={() => router.push({ pathname: '/teacher-courses', params: { teacherId: item.id, teacherName } })}
            testID={`teacher-name-link-${item.id}`}
          >
            <Text style={[styles.tName, styles.tNameLink]} numberOfLines={1}>{teacherName}</Text>
            {item.academic_title ? <Text style={styles.tSubName} numberOfLines={1}>{item.academic_title}</Text> : null}
          </TouchableOpacity>
        </View>
        <View style={[styles.colPhone, styles.cellPad]}>
          <Text style={styles.tCell}>{getTeacherId(item)}</Text>
        </View>
        <View style={[styles.colDept, styles.cellPad]}>
          <Text style={styles.tCell} numberOfLines={1}>{dept}</Text>
        </View>
        <View style={[styles.colSpec, styles.cellPad]}>
          <Text style={styles.tCell} numberOfLines={1}>{item.specialization || '—'}</Text>
        </View>
        <View style={[styles.colLoad, styles.cellPad]}>
          <Text style={styles.tCell}>{loadHours} س</Text>
        </View>
        <View style={[styles.colCourses, styles.cellPad]}>
          <View style={styles.coursesBadge}>
            <Ionicons name="book-outline" size={11} color="#1565c0" />
            <Text style={styles.coursesBadgeText}>{coursesCount}</Text>
          </View>
        </View>
        <View style={[styles.colAcc, styles.cellPad]}>
          <View style={[styles.accPill, { backgroundColor: hasAccount ? '#e7f6ee' : '#fafafa' }]}>
            <Text style={[styles.accPillText, { color: hasAccount ? '#22a35a' : '#9e9e9e' }]}>{hasAccount ? 'مفعل' : 'غير مفعل'}</Text>
          </View>
        </View>
        <View style={[styles.colActions, styles.cellPad]}>
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
          <ScrollView style={styles.formContainer}>
            <Text style={styles.formTitle}>
              {editingTeacher ? 'تعديل بيانات المعلم' : 'إضافة معلم جديد'}
            </Text>

            <Text style={styles.label}>رقم الجوال *</Text>
            <TextInput
              style={[styles.input, editingTeacher && styles.inputDisabled]}
              value={formData.teacher_id}
              onChangeText={(text) => setFormData({ ...formData, teacher_id: text.replace(/[^0-9+]/g, '') })}
              placeholder="أدخل رقم الجوال"
              keyboardType="phone-pad"
              editable={!editingTeacher}
            />

            <Text style={styles.label}>الاسم الكامل *</Text>
            <TextInput
              style={styles.input}
              value={formData.full_name}
              onChangeText={(text) => setFormData({ ...formData, full_name: text })}
              placeholder="أدخل الاسم الكامل"
            />

            <Text style={styles.label}>الأقسام (يمكن اختيار أكثر من قسم)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.deptScroll}>
              {departments.map(dept => {
                const isSelected = formData.department_ids.includes(dept.id);
                return (
                  <TouchableOpacity
                    key={dept.id}
                    style={[styles.deptBtn, isSelected && styles.deptBtnActive]}
                    onPress={() => {
                      const newIds = isSelected
                        ? formData.department_ids.filter(id => id !== dept.id)
                        : [...formData.department_ids, dept.id];
                      setFormData({ ...formData, department_ids: newIds });
                    }}
                  >
                    <Ionicons 
                      name={isSelected ? 'checkbox' : 'square-outline'} 
                      size={16} 
                      color={isSelected ? '#fff' : '#666'} 
                      style={{ marginLeft: 4 }}
                    />
                    <Text style={[styles.deptBtnText, isSelected && styles.deptBtnTextActive]}>
                      {dept.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Text style={styles.label}>التخصص</Text>
            <TextInput
              style={styles.input}
              value={formData.specialization}
              onChangeText={(text) => setFormData({ ...formData, specialization: text })}
              placeholder="التخصص العلمي"
            />

            <Text style={styles.label}>الوصف الأكاديمي</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.deptScroll}>
              {['أستاذ', 'أستاذ مشارك', 'أستاذ مساعد', 'محاضر', 'معيد'].map(title => (
                <TouchableOpacity
                  key={title}
                  style={[styles.deptBtn, formData.academic_title === title && styles.deptBtnActive]}
                  onPress={() => setFormData({ ...formData, academic_title: title })}
                >
                  <Text style={[styles.deptBtnText, formData.academic_title === title && styles.deptBtnTextActive]}>
                    {title}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.label}>النصاب الأسبوعي (ساعات) *</Text>
            <TextInput
              style={styles.input}
              value={formData.weekly_hours}
              onChangeText={(text) => {
                const numericValue = text.replace(/[^0-9]/g, '');
                setFormData({ ...formData, weekly_hours: numericValue });
              }}
              placeholder="النصاب الأسبوعي (افتراضي 12 ساعة)"
              keyboardType="numeric"
              testID="weekly-hours-input"
            />

            <Text style={styles.label}>رقم الهاتف</Text>
            <TextInput
              style={styles.input}
              value={formData.phone}
              onChangeText={(text) => setFormData({ ...formData, phone: text })}
              placeholder="رقم الهاتف"
              keyboardType="phone-pad"
            />

            <Text style={styles.label}>البريد الإلكتروني</Text>
            <TextInput
              style={styles.input}
              value={formData.email}
              onChangeText={(text) => setFormData({ ...formData, email: text })}
              placeholder="البريد الإلكتروني"
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <View style={styles.formButtons}>
              <TouchableOpacity
                style={[styles.btn, styles.cancelBtn]}
                onPress={() => {
                  setShowForm(false);
                  setEditingTeacher(null);
                  resetForm();
                }}
              >
                <Text style={styles.cancelBtnText}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.saveBtn, saving && styles.savingBtn]}
                onPress={handleSubmit}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.saveBtnText}>
                    {editingTeacher ? 'تحديث' : 'حفظ'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        ) : (
          <ScrollView dataSet={{ responsiveScrollRoot: "true" }} style={{ flex: 1 }} contentContainerStyle={styles.pageScroll} showsVerticalScrollIndicator={false}>

            {/* رأس الصفحة */}
            <View dataSet={{ responsive: "page-header" }} style={styles.pageHeader}>
              <View style={styles.pageHeaderRight}>
                <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <Text dataSet={{ responsive: "page-title" }} style={styles.pageTitle}>المعلمون</Text>
                  {!!activeSemesterName && (
                    <View style={styles.semesterBadge} testID="active-semester-badge">
                      <Ionicons name="calendar" size={11} color="#1565c0" />
                      <Text style={styles.semesterBadgeText}>بيانات الفصل: {activeSemesterName}</Text>
                    </View>
                  )}
                </View>
                <View style={styles.breadcrumb}>
                  <TouchableOpacity onPress={() => router.replace('/')}>
                    <Text style={styles.breadcrumbLink}>الرئيسية</Text>
                  </TouchableOpacity>
                  <Ionicons name="chevron-back" size={12} color="#8a95a8" />
                  <Text style={styles.breadcrumbCurrent}>المعلمون</Text>
                </View>
              </View>
              <View dataSet={{ responsive: "page-header-actions" }} style={styles.pageHeaderActions}>
                <TouchableOpacity style={[styles.headerBtn, styles.btnPrimary]} onPress={() => setShowForm(true)}>
                  <Ionicons name="add" size={16} color="#fff" />
                  <Text style={styles.btnPrimaryText}>إضافة معلم</Text>
                </TouchableOpacity>
                {Platform.OS === 'web' && (
                  <>
                    <TouchableOpacity style={[styles.headerBtn, styles.btnSuccess]} onPress={() => { setImportDeptId(''); setImportResult(null); setShowImportModal(true); }}>
                      <Ionicons name="document-text-outline" size={16} color="#fff" />
                      <Text style={styles.btnPrimaryText}>استيراد Excel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.headerBtn, styles.btnGhost]} onPress={handleRestore} disabled={restoring}>
                      <Ionicons name="refresh" size={16} color="#1a2540" />
                      <Text style={styles.btnGhostText}>{restoring ? 'جاري...' : 'استعادة'}</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>

            {/* بطاقات الإحصائيات */}
            <View dataSet={{ responsive: "stats-grid" }} style={styles.statsGrid}>
              <View style={styles.statCard}>
                <View style={[styles.statIconWrap, { backgroundColor: '#4caf50' }]}>
                  <Ionicons name="people" size={22} color="#fff" />
                </View>
                <View style={styles.statTextCol}>
                  <Text style={styles.statLabel}>إجمالي المعلمين</Text>
                  <Text style={styles.statValue}>{teachers.length}</Text>
                  <Text style={styles.statSubLabel}>معلم</Text>
                </View>
              </View>
              <View style={styles.statCard}>
                <View style={[styles.statIconWrap, { backgroundColor: '#29b6f6' }]}>
                  <Ionicons name="eye" size={22} color="#fff" />
                </View>
                <View style={styles.statTextCol}>
                  <Text style={styles.statLabel}>المعروض حالياً</Text>
                  <Text style={styles.statValue}>{filteredTeachers.length}</Text>
                  <Text style={styles.statSubLabel}>من {teachers.length} معلم</Text>
                </View>
              </View>
              <View style={styles.statCard}>
                <View style={[styles.statIconWrap, { backgroundColor: '#ff9800' }]}>
                  <Ionicons name="checkmark-circle" size={22} color="#fff" />
                </View>
                <View style={styles.statTextCol}>
                  <Text style={styles.statLabel}>الحسابات المفعّلة</Text>
                  <Text style={styles.statValue}>{teachers.filter(t => !!t.user_id).length}</Text>
                  <Text style={styles.statSubLabel}>حساب نشط</Text>
                </View>
              </View>
              <View style={styles.statCard}>
                <View style={[styles.statIconWrap, { backgroundColor: '#7c4dff' }]}>
                  <Ionicons name="business" size={22} color="#fff" />
                </View>
                <View style={styles.statTextCol}>
                  <Text style={styles.statLabel}>القسم</Text>
                  <Text style={styles.statValue} numberOfLines={1}>{filterDepartment ? (departments.find(d => d.id === filterDepartment)?.name || 'الكل') : 'الكل'}</Text>
                  <Text style={styles.statSubLabel}>القسم الحالي</Text>
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
                      placeholder="ابحث بالاسم أو رقم الجوال..."
                      value={searchQuery}
                      onChangeText={(v) => { setSearchQuery(v); setCurrentPage(1); }}
                      placeholderTextColor="#a8b1c2"
                    />
                  </View>
                </View>
                <View style={styles.filterField}>
                  <Text style={styles.filterLbl}>القسم</Text>
                  <View style={styles.dropdown}>
                    <Picker
                      selectedValue={filterDepartment}
                      onValueChange={(v) => { setFilterDepartment(v); setCurrentPage(1); }}
                      style={styles.dropdownInner}
                    >
                      <Picker.Item label="الكل" value="" />
                      {departments.map(d => <Picker.Item key={d.id} label={d.name} value={d.id} />)}
                    </Picker>
                  </View>
                </View>
                <View style={styles.filterBtns}>
                  <TouchableOpacity
                    style={styles.resetBtn}
                    onPress={() => { setFilterDepartment(''); setSearchQuery(''); setCurrentPage(1); }}
                    disabled={!filterDepartment && !searchQuery}
                  >
                    <Ionicons name="refresh" size={13} color={(filterDepartment || searchQuery) ? '#2962ff' : '#a8b1c2'} />
                    <Text style={[styles.resetBtnText, !(filterDepartment || searchQuery) && { color: '#a8b1c2' }]}>إعادة تعيين</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.headerBtn, styles.btnPrimary, { paddingHorizontal: 18 }]}>
                    <Text style={styles.btnPrimaryText}>تطبيق الفلتر</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            {/* بطاقة الجدول — لا تُعرض حتى يختار المستخدم فلتراً */}
            {!hasActiveFilter ? (
              <View style={{ backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#eef1f6', padding: 50, alignItems: 'center', gap: 14 }}>
                <Ionicons name="filter-circle-outline" size={72} color="#cfd6e1" />
                <Text style={{ fontSize: 17, fontWeight: '700', color: '#1a2540', textAlign: 'center' }}>اختر فلتراً لعرض المعلمين</Text>
                <Text style={{ fontSize: 13, color: '#8a95a8', textAlign: 'center', maxWidth: 460, lineHeight: 22 }}>
                  حدّد قسماً، أو اكتب اسم/رقم وظيفي معلم في حقل البحث أعلاه لعرض النتائج.
                </Text>
              </View>
            ) : (
            <View style={styles.tableCard}>
              <View style={styles.tableCardHeader}>
                <Text style={styles.tableCardTitle}>قائمة المعلمين</Text>
                <Text style={styles.tableCardCount}>
                  عرض <Text style={styles.tableCardCountAccent}>{filteredTeachers.length}</Text> من <Text style={styles.tableCardCountAccent}>{teachers.length}</Text> معلم
                </Text>
              </View>

              <View dataSet={{ responsive: "table-header-row" }} style={styles.tableHeaderRow}>
                <TouchableOpacity
                  onPress={() => {
                    const ids = filteredTeachers.map((t: any) => t.id);
                    setSelectedIds(p => ids.every(i => p.includes(i)) ? p.filter(x => !ids.includes(x)) : Array.from(new Set([...p, ...ids])));
                  }}
                  style={{ width: 34, alignItems: 'center', justifyContent: 'center' }}
                  testID="teachers-select-all"
                >
                  <Ionicons
                    name={filteredTeachers.length > 0 && filteredTeachers.every((t: any) => selectedIds.includes(t.id)) ? 'checkbox' : 'square-outline'}
                    size={20}
                    color="#1565c0"
                  />
                </TouchableOpacity>
                <SortableHeader label="المعلم" field="name" currentSort={sortBy} onSort={(v) => { setSortBy(v); setCurrentPage(1); }} containerStyle={[styles.colTeacher, styles.cellPad]} />
                <View style={[styles.colPhone, styles.cellPad]}><Text style={styles.thText}>رقم الجوال</Text></View>
                <View style={[styles.colDept, styles.cellPad]}><Text style={styles.thText}>القسم</Text></View>
                <View style={[styles.colSpec, styles.cellPad]}><Text style={styles.thText}>التخصص</Text></View>
                <SortableHeader label="النصاب" field="hours" currentSort={sortBy} onSort={(v) => { setSortBy(v); setCurrentPage(1); }} containerStyle={[styles.colLoad, styles.cellPad]} />
                <SortableHeader label="المقررات" field="courses" currentSort={sortBy} onSort={(v) => { setSortBy(v); setCurrentPage(1); }} containerStyle={[styles.colCourses, styles.cellPad]} />
                <View style={[styles.colAcc, styles.cellPad]}><Text style={styles.thText}>الحساب</Text></View>
                <View style={[styles.colActions, styles.cellPad]}><Text style={styles.thText}>العمليات</Text></View>
              </View>

              {filteredTeachers.length === 0 ? (
                <View style={styles.tableEmpty}>
                  <Ionicons name="people-outline" size={48} color="#cfd6e1" />
                  <Text style={styles.tableEmptyText}>لا توجد نتائج للفلاتر المطبّقة</Text>
                </View>
              ) : (
                <View>
                  {filteredTeachers.slice((currentPage - 1) * perPage, currentPage * perPage).map((item, index) => (
                    <View key={item.id}>{renderTeacher({ item, index })}</View>
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
                {Math.ceil(filteredTeachers.length / perPage) > 1 && (
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
                      const totalPages = Math.ceil(filteredTeachers.length / perPage);
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
                    <TouchableOpacity
                      style={[styles.pagerNavBtn, currentPage >= Math.ceil(filteredTeachers.length / perPage) && styles.pagerNavBtnDisabled]}
                      onPress={() => setCurrentPage(p => Math.min(Math.ceil(filteredTeachers.length / perPage), p + 1))}
                      disabled={currentPage >= Math.ceil(filteredTeachers.length / perPage)}
                    >
                      <Text style={[styles.pagerNavText, currentPage >= Math.ceil(filteredTeachers.length / perPage) && { color: '#c0c8d4' }]}>التالي</Text>
                      <Ionicons name="chevron-back" size={14} color={currentPage >= Math.ceil(filteredTeachers.length / perPage) ? '#c0c8d4' : '#1a2540'} />
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </View>
            )}

          </ScrollView>
        )}
      </KeyboardAvoidingView>

      {/* ✅ شريط الإجراءات الجماعية */}
      {selectedIds.length > 0 && !showForm && (
        <View style={{
          position: (Platform.OS === 'web' ? 'fixed' : 'absolute') as any, bottom: 0, left: 0, right: 0, backgroundColor: '#1a2540',
          flexDirection: 'row-reverse', alignItems: 'center', flexWrap: 'wrap', gap: 8,
          paddingHorizontal: 14, paddingVertical: 10, zIndex: 50,
        }} testID="bulk-actions-bar">
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>☑️ {selectedIds.length} محدد</Text>
          {[
            { action: 'activate', label: 'تفعيل الحسابات', icon: 'key', color: '#2e7d32' },
            { action: 'deactivate', label: 'إيقاف الحسابات', icon: 'lock-closed', color: '#ef6c00' },
            { action: 'reset_password', label: 'إعادة كلمات المرور', icon: 'refresh', color: '#6a1b9a' },
            { action: 'add_department', label: 'إضافة إلى قسم', icon: 'business', color: '#00695c', needsDept: true },
            { action: 'safe_delete', label: 'حذف آمن', icon: 'trash', color: '#c62828', danger: true },
          ].map((b: any) => (
            <TouchableOpacity
              key={b.action}
              onPress={() => setBulkConfirm(b)}
              style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 4, backgroundColor: b.color, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 }}
              testID={`bulk-${b.action}-btn`}
            >
              <Ionicons name={b.icon} size={13} color="#fff" />
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{b.label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            onPress={() => exportSelected('excel')}
            disabled={bulkBusy}
            style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 4, backgroundColor: '#1565c0', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 }}
            testID="bulk-export-btn"
          >
            <Ionicons name="download" size={13} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{bulkBusy ? '...' : 'تصدير Excel'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => exportSelected('pdf')}
            disabled={bulkBusy}
            style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 4, backgroundColor: '#8e24aa', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 }}
            testID="bulk-export-pdf-btn"
          >
            <Ionicons name="document-text" size={13} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{bulkBusy ? '...' : 'تصدير PDF'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setSelectedIds([])} style={{ marginRight: 'auto' as any }} testID="bulk-clear-btn">
            <Text style={{ color: '#b8c4d6', fontSize: 12, fontWeight: '700' }}>✕ إلغاء التحديد</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* نافذة تأكيد الإجراء الجماعي */}
      {bulkConfirm && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 20, width: 420, maxWidth: '92%' }} testID="bulk-confirm-modal">
            <Text style={{ fontSize: 15, fontWeight: '800', color: bulkConfirm.danger ? '#c62828' : '#1a2540', textAlign: 'right', marginBottom: 8 }}>
              {bulkConfirm.danger ? '⚠️ ' : ''}{bulkConfirm.label} — {selectedIds.length} مدرس
            </Text>
            <Text style={{ fontSize: 12.5, color: '#5b6678', textAlign: 'right', lineHeight: 20, marginBottom: 12 }}>
              {bulkConfirm.action === 'safe_delete'
                ? 'سيتم أرشفة المدرسين المحددين مع نسخة احتياطية في سلة المحذوفات (يمكن استعادتهم)، وستُفك ارتباطاتهم بالمقررات والجدول.'
                : bulkConfirm.action === 'activate'
                ? 'سيتم إنشاء حساب دخول لكل مدرس محدد (اسم المستخدم وكلمة المرور = الرقم الوظيفي، مع إجبار تغييرها عند أول دخول).'
                : bulkConfirm.action === 'deactivate'
                ? 'سيتم حذف حسابات دخول المدرسين المحددين (بياناتهم تبقى، ويمكن إعادة التفعيل لاحقاً).'
                : bulkConfirm.action === 'reset_password'
                ? 'ستُعاد كلمات مرور المحددين إلى الرقم الوظيفي مع إجبار التغيير عند أول دخول.'
                : 'سيُضاف القسم المختار إلى انتماءات كل المدرسين المحددين (دون إزالة أقسامهم الحالية).'}
            </Text>
            {bulkConfirm.needsDept && (
              <View style={{ borderWidth: 1, borderColor: '#dbe3ee', borderRadius: 8, marginBottom: 12 }}>
                <Picker selectedValue={bulkDeptId} onValueChange={setBulkDeptId} style={{ height: 40 }} testID="bulk-dept-picker">
                  <Picker.Item label="— اختر القسم —" value="" />
                  {departments.map((d: any) => <Picker.Item key={d.id} label={d.name} value={d.id} />)}
                </Picker>
              </View>
            )}
            <View style={{ flexDirection: 'row-reverse', gap: 8 }}>
              <TouchableOpacity
                onPress={() => runBulkAction(bulkConfirm.action)}
                disabled={bulkBusy || (bulkConfirm.needsDept && !bulkDeptId)}
                style={{ flex: 1, backgroundColor: bulkConfirm.danger ? '#c62828' : '#1565c0', opacity: (bulkBusy || (bulkConfirm.needsDept && !bulkDeptId)) ? 0.5 : 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' }}
                testID="bulk-confirm-btn"
              >
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>{bulkBusy ? 'جاري التنفيذ...' : 'تأكيد'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setBulkConfirm(null); setBulkDeptId(''); }} disabled={bulkBusy} style={{ flex: 0.6, borderWidth: 1, borderColor: '#dbe3ee', paddingVertical: 10, borderRadius: 8, alignItems: 'center' }} testID="bulk-cancel-btn">
                <Text style={{ color: '#5b6678', fontWeight: '700', fontSize: 13 }}>إلغاء</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* نتيجة الإجراء الجماعي */}
      {bulkResult && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 20, width: 440, maxWidth: '92%', maxHeight: '80%' }} testID="bulk-result-modal">
            <Text style={{ fontSize: 14.5, fontWeight: '800', color: '#1a2540', textAlign: 'right', marginBottom: 10 }}>{bulkResult.message}</Text>
            <ScrollView style={{ maxHeight: 300 }}>
              {bulkResult.activated?.length > 0 && (
                <View style={{ backgroundColor: '#e8f5e9', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: '#2e7d32', textAlign: 'right', marginBottom: 4 }}>الحسابات المفعلة (كلمة المرور = الرقم الوظيفي):</Text>
                  {bulkResult.activated.map((a: any, i: number) => (
                    <Text key={i} style={{ fontSize: 11.5, color: '#33691e', textAlign: 'right', paddingVertical: 2 }}>• {a.name} — {a.username}</Text>
                  ))}
                </View>
              )}
              {bulkResult.failed?.length > 0 && (
                <View style={{ backgroundColor: '#fff3e0', borderRadius: 8, padding: 10 }}>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: '#e65100', textAlign: 'right', marginBottom: 4 }}>لم يُنفذ على ({bulkResult.failed.length}):</Text>
                  {bulkResult.failed.map((f: string, i: number) => (
                    <Text key={i} style={{ fontSize: 11.5, color: '#bf360c', textAlign: 'right', paddingVertical: 2 }}>• {f}</Text>
                  ))}
                </View>
              )}
            </ScrollView>
            <TouchableOpacity onPress={() => setBulkResult(null)} style={{ backgroundColor: '#1565c0', paddingVertical: 10, borderRadius: 8, alignItems: 'center', marginTop: 12 }} testID="bulk-result-close">
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>إغلاق</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* قائمة العمليات (3 نقاط) - Modal مركّز */}
      {openMenuId && (() => {
        const t = teachers.find(x => x.id === openMenuId);
        if (!t) return null;
        const hasAcc = !!t.user_id;
        return (
          <Modal visible transparent animationType="fade" onRequestClose={() => setOpenMenuId(null)}>
            <View style={styles.modalOverlay}>
              <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setOpenMenuId(null)} />
              <View style={styles.menuModalCard}>
                <View style={styles.menuModalHeader}>
                  <Text style={styles.menuModalTitle} numberOfLines={1}>{getTeacherName(t)}</Text>
                  <TouchableOpacity onPress={() => setOpenMenuId(null)}>
                    <Ionicons name="close" size={20} color="#5b6678" />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={styles.menuItem} onPress={() => { setOpenMenuId(null); router.push({ pathname: '/teacher-courses', params: { teacherId: t.id, teacherName: getTeacherName(t) } }); }}>
                  <Ionicons name="book-outline" size={18} color="#9c27b0" />
                  <Text style={styles.menuText}>عرض المقررات</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.menuItem} onPress={() => { setOpenMenuId(null); handleEdit(t); }}>
                  <Ionicons name="pencil-outline" size={18} color="#4caf50" />
                  <Text style={styles.menuText}>تعديل</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.menuItem} onPress={() => { setOpenMenuId(null); hasAcc ? handleDeactivateAccount(t) : handleActivateAccount(t); }}>
                  <Ionicons name={hasAcc ? 'person-remove-outline' : 'person-add-outline'} size={18} color={hasAcc ? '#9e9e9e' : '#4caf50'} />
                  <Text style={styles.menuText}>{hasAcc ? 'إلغاء تفعيل الحساب' : 'تفعيل الحساب'}</Text>
                </TouchableOpacity>
                {hasAcc && (
                  <TouchableOpacity style={styles.menuItem} onPress={() => { setOpenMenuId(null); handleResetPassword(t); }}>
                    <Ionicons name="key-outline" size={18} color="#ff9800" />
                    <Text style={styles.menuText}>إعادة تعيين كلمة المرور</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={[styles.menuItem, styles.menuItemDanger]} onPress={() => { setOpenMenuId(null); handleDelete(t); }}>
                  <Ionicons name="trash-outline" size={18} color="#f44336" />
                  <Text style={[styles.menuText, { color: '#f44336' }]}>حذف</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        );
      })()}
      
      {/* Loading overlay */}
      {saving && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#1565c0" />
        </View>
      )}
      
      {/* نافذة استيراد المعلمين */}
      <Modal visible={showImportModal} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 24, width: '90%', maxWidth: 450 }}>
            <Ionicons name="cloud-download" size={36} color="#4caf50" style={{ alignSelf: 'center', marginBottom: 10 }} />
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#333', textAlign: 'center', marginBottom: 4 }}>
              استيراد المعلمين من Excel
            </Text>
            <Text style={{ fontSize: 13, color: '#888', textAlign: 'center', marginBottom: 16 }}>
              سيتم تفعيل حساب كل معلم تلقائياً (اسم المستخدم وكلمة المرور = الرقم الوظيفي)
            </Text>
            
            {/* تنزيل النموذج */}
            <TouchableOpacity
              style={{ flexDirection: 'row', backgroundColor: '#e8f5e9', padding: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 16 }}
              onPress={handleDownloadTemplate}
            >
              <Ionicons name="download" size={20} color="#4caf50" />
              <Text style={{ color: '#4caf50', fontWeight: '600', fontSize: 14 }}>تنزيل نموذج Excel فارغ</Text>
            </TouchableOpacity>
            
            {/* اختيار القسم */}
            <Text style={{ fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 6 }}>القسم الافتراضي *</Text>
            <View style={{ backgroundColor: '#f5f5f5', borderRadius: 8, borderWidth: 1, borderColor: '#e0e0e0', overflow: 'hidden', marginBottom: 16 }}>
              <Picker
                selectedValue={importDeptId}
                onValueChange={setImportDeptId}
                style={{ height: 45 }}
              >
                <Picker.Item label="-- اختر القسم --" value="" />
                {departments.map(dept => (
                  <Picker.Item key={dept.id} label={dept.name} value={dept.id} />
                ))}
              </Picker>
            </View>
            
            {/* نتيجة الاستيراد */}
            {importResult && !importResult.error && (
              <View style={{ backgroundColor: '#e8f5e9', padding: 12, borderRadius: 8, marginBottom: 12 }}>
                <Text style={{ color: '#2e7d32', fontWeight: '600', textAlign: 'center', marginBottom: 4 }}>
                  تم استيراد {importResult.imported} معلم | تفعيل {importResult.activated} حساب
                </Text>
                {importResult.errors?.length > 0 && (
                  <View style={{ marginTop: 8 }}>
                    {importResult.errors.map((err: string, i: number) => (
                      <Text key={i} style={{ color: '#e65100', fontSize: 12 }}>{err}</Text>
                    ))}
                  </View>
                )}
              </View>
            )}
            {importResult?.error && (
              <View style={{ backgroundColor: '#ffebee', padding: 12, borderRadius: 8, marginBottom: 12 }}>
                <Text style={{ color: '#c62828', textAlign: 'center' }}>{importResult.error}</Text>
              </View>
            )}
            
            {/* أزرار */}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: '#f5f5f5', padding: 14, borderRadius: 10, alignItems: 'center' }}
                onPress={() => setShowImportModal(false)}
              >
                <Text style={{ color: '#666', fontWeight: '600' }}>إغلاق</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: '#4caf50', padding: 14, borderRadius: 10, alignItems: 'center', opacity: (importing || !importDeptId) ? 0.6 : 1 }}
                onPress={handleImportExcel}
                disabled={importing || !importDeptId}
              >
                {importing ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={{ color: '#fff', fontWeight: '700' }}>اختر ملف Excel</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      
      {/* نافذة الحذف الآمن */}
      <Modal visible={showDeleteModal} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 24, width: '90%', maxWidth: 420 }}>
            <Ionicons name="warning" size={40} color="#f44336" style={{ alignSelf: 'center', marginBottom: 12 }} />
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#333', textAlign: 'center', marginBottom: 8 }}>
              حذف المعلم
            </Text>
            <Text style={{ fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 16 }}>
              "{deleteTarget ? getTeacherName(deleteTarget) : ''}"
            </Text>
            
            {deleteInfo && !deleteInfo.error ? (
              <View style={{ backgroundColor: '#fff3e0', padding: 14, borderRadius: 10, marginBottom: 16 }}>
                <Text style={{ fontSize: 13, color: '#e65100', fontWeight: '600', marginBottom: 8, textAlign: 'center' }}>
                  سيتم حذف التالي نهائياً:
                </Text>
                <Text style={{ fontSize: 13, color: '#555', lineHeight: 24 }}>
                  {`• ${deleteInfo.courses_count} مقرر مرتبط${deleteInfo.courses_names?.length ? ` (${deleteInfo.courses_names.join('، ')})` : ''}\n• ${deleteInfo.lectures_count} محاضرة\n• ${deleteInfo.attendance_count} سجل حضور${deleteInfo.has_user_account ? '\n• حساب المستخدم سيتم حذفه' : ''}`}
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
                testID="cancel-delete-teacher-btn"
              >
                <Text style={{ color: '#666', fontWeight: '600' }}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: '#f44336', padding: 14, borderRadius: 10, alignItems: 'center', opacity: (deletingTeacher || !deleteInfo || deleteInfo.error) ? 0.6 : 1 }}
                onPress={confirmSafeDelete}
                disabled={deletingTeacher || !deleteInfo || deleteInfo.error}
                testID="confirm-delete-teacher-btn"
              >
                {deletingTeacher ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={{ color: '#fff', fontWeight: '700' }}>حذف نهائي</Text>
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

  // ====== التصميم الجديد ======
  pageScroll: { padding: 20, paddingBottom: 60, maxWidth: 1440, width: '100%', alignSelf: 'center' },
  pageHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 12 },
  pageHeaderRight: { alignItems: 'flex-end' },
  pageTitle: { fontSize: 26, fontWeight: '700', color: '#1a2540', textAlign: 'right', marginBottom: 6 },
  semesterBadge: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12,
    backgroundColor: '#e7f0fe', borderWidth: 1, borderColor: '#bdd4fd',
    marginBottom: 6,
  },
  semesterBadgeText: { fontSize: 11, color: '#1565c0', fontWeight: '700' },
  breadcrumb: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  breadcrumbLink: { fontSize: 13, color: '#2962ff', fontWeight: '500' },
  breadcrumbCurrent: { fontSize: 13, color: '#8a95a8', fontWeight: '500' },
  pageHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
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
  cellPad: { paddingVertical: 12, paddingHorizontal: 14 },
  colTeacher: { flex: 2.4, flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  colPhone: { flex: 1.2 },
  colDept: { flex: 1.4 },
  colSpec: { flex: 1.3 },
  colLoad: { flex: 0.8 },
  colCourses: { flex: 0.8 },
  colAcc: { flex: 1 },
  colActions: { flex: 0.7, alignItems: 'flex-start' },
  tAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  tAvatarText: { fontSize: 14, fontWeight: '700' },
  tName: { fontSize: 13, fontWeight: '600', color: '#1a2540', textAlign: 'right' },
  tNameLink: { color: '#2962ff', ...Platform.select({ web: { cursor: 'pointer' as any } }) },
  tSubName: { fontSize: 11, color: '#8a95a8', textAlign: 'right', marginTop: 2 },
  tCell: { fontSize: 13, color: '#1a2540', textAlign: 'right' },
  coursesBadge: { alignSelf: 'flex-end', flexDirection: 'row-reverse', alignItems: 'center', gap: 4, backgroundColor: '#e7f0fe', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  coursesBadgeText: { fontSize: 12, color: '#1565c0', fontWeight: '700' },
  accPill: { alignSelf: 'flex-end', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 },
  accPillText: { fontSize: 11, fontWeight: '700' },
  dotsBtn: { width: 32, height: 32, borderRadius: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#e3e7ee', backgroundColor: '#fff' },
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
    backgroundColor: '#1565c0',
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
    marginBottom: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  searchInput: {
    flex: 1,
    paddingVertical: 8,
    fontSize: 13,
    textAlign: 'right',
  },
  filterScroll: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  filterBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    marginRight: 8,
  },
  filterBtnActive: {
    backgroundColor: '#1565c0',
    borderColor: '#1565c0',
  },
  filterText: {
    fontSize: 13,
    color: '#333',
  },
  filterTextActive: {
    color: '#fff',
  },
  filterContainer: {
    padding: 10,
    backgroundColor: '#f8f9fa',
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 10,
  },
  dropdownRow: {
    flexDirection: 'row',
    gap: 8,
  },
  dropdownContainer: {
    flex: 1,
  },
  dropdownLabel: {
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
  countContainer: {
    backgroundColor: '#e3f2fd',
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 8,
  },
  countText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1565c0',
    textAlign: 'center',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  teacherCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  teacherInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 0,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
  },
  avatarText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#fff',
  },
  teacherDetails: {
    flex: 1,
    gap: 2,
  },
  teacherTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  teacherMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
  },
  teacherMeta: {
    fontSize: 11,
    color: '#777',
  },
  teacherCoursesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 3,
    marginTop: 2,
  },
  courseChipMini: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e3f2fd',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    gap: 2,
  },
  courseChipMiniText: {
    fontSize: 10,
    color: '#1565c0',
  },
  teacherName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#222',
  },
  teacherId: {
    fontSize: 11,
    color: '#777',
  },
  teacherDept: {
    fontSize: 11,
    color: '#1565c0',
  },
  teacherSpec: {
    fontSize: 11,
    color: '#999',
  },
  academicTitle: {
    fontSize: 11,
    color: '#4caf50',
    fontWeight: '600',
  },
  teachingLoad: {
    fontSize: 11,
    color: '#ff9800',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
    gap: 2,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '500',
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    paddingTop: 12,
  },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  activateBtn: {
    backgroundColor: '#e8f5e9',
  },
  deactivateBtn: {
    backgroundColor: '#ffebee',
  },
  resetBtn: {
    backgroundColor: '#fff3e0',
  },
  coursesBtn: {
    backgroundColor: '#f3e5f5',
  },
  editBtn: {
    backgroundColor: '#e3f2fd',
  },
  deleteBtn: {
    backgroundColor: '#ffebee',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 60,
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
    marginTop: 16,
  },
  formContainer: {
    padding: 16,
  },
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
  inputDisabled: {
    backgroundColor: '#f5f5f5',
    color: '#999',
  },
  deptScroll: {
    marginBottom: 8,
  },
  deptBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  deptBtnActive: {
    backgroundColor: '#1565c0',
    borderColor: '#1565c0',
  },
  deptBtnText: {
    fontSize: 14,
    color: '#666',
  },
  deptBtnTextActive: {
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
    backgroundColor: '#1565c0',
    marginLeft: 8,
  },
  savingBtn: {
    opacity: 0.7,
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
