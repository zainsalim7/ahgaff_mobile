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
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { Picker } from '@react-native-picker/picker';
import { departmentsAPI, studentsAPI, exportAPI, API_URL } from '../src/services/api';
import { Department, Student } from '../src/types';
import { LoadingScreen } from '../src/components/LoadingScreen';
import { useAuth, PERMISSIONS } from '../src/contexts/AuthContext';
import AsyncStorage from '@react-native-async-storage/async-storage';

const LEVELS = ['1', '2', '3', '4', '5'];

// دالة مساعدة للتأكيد تعمل على الويب والموبايل
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
      // تنفيذ الـ callback
      console.log('User confirmed, executing callback...');
      try {
        const result = onConfirm();
        if (result instanceof Promise) {
          result.then(() => {
            console.log('Callback completed successfully');
          }).catch(err => {
            console.error('Error in confirm callback:', err);
          });
        }
      } catch (err) {
        console.error('Sync error in confirm callback:', err);
      }
    }
  } else {
    Alert.alert(title, message, [
      { text: 'إلغاء', style: 'cancel' },
      { 
        text: confirmText, 
        style: destructive ? 'destructive' : 'default', 
        onPress: () => {
          console.log('User confirmed (mobile), executing callback...');
          try {
            const result = onConfirm();
            if (result instanceof Promise) {
              result.then(() => {
                console.log('Callback completed successfully');
              }).catch(err => {
                console.error('Error in confirm callback:', err);
              });
            }
          } catch (err) {
            console.error('Sync error in confirm callback:', err);
          }
        }
      },
    ]);
  }
};

// دالة مساعدة لعرض رسالة
const showMessage = (title: string, message: string) => {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
};

export default function AddStudentScreen() {
  const router = useRouter();
  const { hasPermission, user, isLoading: authLoading } = useAuth();
  
  // الطالب لا يمكنه الوصول لهذه الصفحة
  const isStudent = user?.role === 'student';
  
  // التحقق من الصلاحيات - يجب أن يكون لديه صلاحية إدارة الطلاب
  // انتظر حتى يتم تحميل بيانات المستخدم
  const canManageStudents = user ? (!isStudent && (hasPermission(PERMISSIONS.MANAGE_STUDENTS) || user.role === 'admin')) : false;
  
  // إعادة توجيه الطالب
  useEffect(() => {
    if (!authLoading && isStudent) {
      router.replace('/');
    }
  }, [isStudent, authLoading]);
  
  const [departments, setDepartments] = useState<Department[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [importing, setImporting] = useState(false);
  
  // وضع الاستيراد - عند تفعيله تظهر إعدادات الاستيراد بدلاً من الفلاتر
  const [importMode, setImportMode] = useState(false);
  
  // فلاتر عرض الطلاب
  const [selectedDeptFilter, setSelectedDeptFilter] = useState<string>('');
  const [selectedLevelFilter, setSelectedLevelFilter] = useState<string>('');
  const [selectedSectionFilter, setSelectedSectionFilter] = useState<string>('');
  
  // إعدادات الاستيراد
  const [importDept, setImportDept] = useState<string>('');
  const [importSection, setImportSection] = useState<string>('');
  const [importLevel, setImportLevel] = useState<string>('1');
  
  // Search
  const [searchQuery, setSearchQuery] = useState<string>('');
  
  // Multi-select for bulk delete
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  // إعادة التوجيه إذا لم يكن لديه صلاحية
  useEffect(() => {
    if (!authLoading && !canManageStudents) {
      showMessage('غير مصرح', 'ليس لديك صلاحية لإدارة الطلاب');
      router.back();
    }
  }, [authLoading, canManageStudents, router]);
  
  // صلاحيات إضافية
  const canEdit = canManageStudents;
  const canDelete = canManageStudents;
  const canImport = hasPermission('import_data') || user?.role === 'admin';

  const [formData, setFormData] = useState({
    student_id: '',
    full_name: '',
    department_id: '',
    level: '1',
    section: '',
    phone: '',
    email: '',
    password: '',
  });

  const fetchData = useCallback(async () => {
    // لا نجلب البيانات إذا لم يكن لديه صلاحية
    if (!canManageStudents) return;
    
    try {
      const [deptsRes, studentsRes] = await Promise.all([
        departmentsAPI.getAll(),
        studentsAPI.getAll(),
      ]);
      setDepartments(deptsRes.data);
      setStudents(studentsRes.data);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  }, [canManageStudents]);

  useEffect(() => {
    if (canManageStudents) {
      fetchData();
    }
  }, [fetchData, canManageStudents]);

  // حساب الطلاب المفلترين مرة واحدة
  const filteredStudents = useMemo(() => {
    console.log('=== Computing filteredStudents ===');
    console.log('Total students:', students.length);
    console.log('Selected Dept:', selectedDeptFilter || 'الكل');
    console.log('Selected Level:', selectedLevelFilter || 'الكل');
    console.log('Selected Section:', selectedSectionFilter || 'الكل');
    
    const result = students.filter(s => {
      // Apply search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const nameMatch = s.full_name?.toLowerCase().includes(query);
        const idMatch = s.student_id?.toLowerCase().includes(query);
        if (!nameMatch && !idMatch) return false;
      }
      // Apply department filter
      if (selectedDeptFilter && s.department_id !== selectedDeptFilter) {
        return false;
      }
      // Apply level filter
      if (selectedLevelFilter && String(s.level) !== selectedLevelFilter) {
        return false;
      }
      // Apply section filter
      if (selectedSectionFilter && s.section !== selectedSectionFilter) {
        return false;
      }
      return true;
    });
    
    console.log('Filtered count:', result.length);
    if (selectedDeptFilter) {
      const deptName = departments.find(d => d.id === selectedDeptFilter)?.name;
      console.log('Dept name:', deptName);
    }
    
    return result;
  }, [students, searchQuery, selectedDeptFilter, selectedLevelFilter, selectedSectionFilter, departments]);

  const handleSubmit = async () => {
    if (!formData.student_id || !formData.full_name || !formData.department_id) {
      Alert.alert('خطأ', 'الرجاء ملء جميع الحقول المطلوبة');
      return;
    }

    setSaving(true);
    try {
      if (editingStudent) {
        // Update existing student
        await studentsAPI.update(editingStudent.id, {
          full_name: formData.full_name,
          department_id: formData.department_id,
          level: parseInt(formData.level),
          section: formData.section,
          phone: formData.phone || undefined,
          email: formData.email || undefined,
        });
        Alert.alert('نجاح', 'تم تحديث بيانات الطالب بنجاح');
      } else {
        // Create new student
        await studentsAPI.create({
          ...formData,
          level: parseInt(formData.level),
          password: formData.password || undefined,
        });
        Alert.alert('نجاح', 'تم إضافة الطالب بنجاح');
      }
      resetForm();
      setShowForm(false);
      setEditingStudent(null);
      fetchData();
    } catch (error: any) {
      const message = error.response?.data?.detail || 'حدث خطأ';
      Alert.alert('خطأ', message);
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setFormData({
      student_id: '',
      full_name: '',
      department_id: '',
      level: '1',
      section: '',
      phone: '',
      email: '',
      password: '',
    });
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
    const visibleIds = students
      .filter(s => {
        if (searchQuery) {
          const query = searchQuery.toLowerCase();
          if (!s.full_name?.toLowerCase().includes(query) && !s.student_id?.toLowerCase().includes(query)) {
            return false;
          }
        }
        if (selectedDeptFilter && s.department_id !== selectedDeptFilter) return false;
        if (selectedLevelFilter && String(s.level) !== selectedLevelFilter) return false;
        return true;
      })
      .map(s => s.id);
    setSelectedIds(new Set(visibleIds));
  };

  // Bulk delete
  const handleBulkDelete = () => {
    if (selectedIds.size === 0) return;
    
    showConfirm('حذف متعدد', `هل أنت متأكد من حذف ${selectedIds.size} طالب؟`, async () => {
      setDeleting(true);
      try {
        const deletePromises = Array.from(selectedIds).map(id => 
          studentsAPI.delete(id)
        );
        await Promise.all(deletePromises);
        showMessage('نجاح', `تم حذف ${selectedIds.size} طالب`);
        setSelectedIds(new Set());
        setSelectionMode(false);
        fetchData();
      } catch (error) {
        showMessage('خطأ', 'فشل في حذف بعض الطلاب');
      } finally {
        setDeleting(false);
      }
    }, 'حذف', true);
  };

  const handleEdit = (student: Student) => {
    setEditingStudent(student);
    setFormData({
      student_id: student.student_id,
      full_name: student.full_name,
      department_id: student.department_id,
      level: String(student.level),
      section: student.section || '',
      phone: student.phone || '',
      email: student.email || '',
      password: '',
    });
    setShowForm(true);
  };

  // استيراد الطلاب من Excel
  const handleImportExcel = async () => {
    console.log('=== handleImportExcel START ===');
    console.log('importDept:', importDept);
    console.log('importLevel:', importLevel);
    console.log('importSection:', importSection);
    
    if (!importDept) {
      Alert.alert('تنبيه', 'اختر قسماً للاستيراد من إعدادات الاستيراد');
      return;
    }
    
    try {
      console.log('Opening document picker...');
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'],
        copyToCacheDirectory: true,
      });
      
      console.log('Document picker result:', JSON.stringify(result));
      
      if (result.canceled) {
        console.log('Document picker was cancelled');
        return;
      }
      
      const file = result.assets[0];
      console.log('File selected:', file.name, 'URI:', file.uri, 'Size:', file.size, 'mimeType:', file.mimeType);
      setImporting(true);
      
      // Build the URL - استخدم importDept بدلاً من selectedDeptFilter
      let url = `${API_URL}/api/import/students?department_id=${importDept}`;
      if (importLevel) url += `&level=${importLevel}`;
      if (importSection) url += `&section=${importSection}`;
      console.log('Upload URL:', url);
      
      // Get auth token
      const token = await AsyncStorage.getItem('token');
      console.log('Token exists:', !!token);
      
      if (Platform.OS === 'web') {
        // Web: Use FormData with fetch
        console.log('Web platform - using FormData...');
        try {
          const response = await fetch(file.uri);
          const blob = await response.blob();
          
          const fileName = file.name || 'students.xlsx';
          const fileType = blob.type || file.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          const fileObject = new File([blob], fileName, { type: fileType });
          
          const formDataObj = new FormData();
          formDataObj.append('file', fileObject, fileName);
          
          const uploadResponse = await fetch(url, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Accept': 'application/json',
            },
            body: formDataObj,
          });
          
          const data = await uploadResponse.json();
          console.log('Web upload response:', data);
          
          if (!uploadResponse.ok) {
            throw { response: { data, status: uploadResponse.status } };
          }
          
          let msg = String(data.message || 'تم الاستيراد');
          if (data.errors && Array.isArray(data.errors) && data.errors.length > 0) {
            msg += '\n\nأخطاء:\n' + data.errors.slice(0, 5).map(String).join('\n');
          }
          Alert.alert('نتيجة الاستيراد', msg);
          fetchData();
        } catch (error: any) {
          throw error;
        }
      } else {
        // Mobile: Use fetch with FormData - more reliable than FileSystem.uploadAsync
        console.log('Mobile platform - using fetch with FormData...');
        console.log('Creating FormData for mobile...');
        
        const formData = new FormData();
        formData.append('file', {
          uri: file.uri,
          name: file.name || 'students.xlsx',
          type: file.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        } as any);
        
        console.log('Sending fetch request to:', url);
        
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Accept': 'application/json',
              // Don't set Content-Type for FormData - let fetch set it with boundary
            },
            body: formData,
          });
          
          console.log('Mobile fetch response status:', response.status);
          const responseText = await response.text();
          console.log('Mobile fetch response text:', responseText);
          
          if (response.ok) {
            const data = JSON.parse(responseText);
            let msg = String(data.message || 'تم الاستيراد');
            if (data.errors && Array.isArray(data.errors) && data.errors.length > 0) {
              msg += '\n\nأخطاء:\n' + data.errors.slice(0, 5).map(String).join('\n');
            }
            Alert.alert('نتيجة الاستيراد', msg);
            fetchData();
          } else {
            let errorData;
            try {
              errorData = JSON.parse(responseText);
            } catch {
              errorData = { detail: responseText };
            }
            throw { response: { data: errorData, status: response.status } };
          }
        } catch (fetchError: any) {
          console.error('Mobile fetch error:', fetchError);
          if (fetchError.message === 'Network request failed') {
            throw { message: 'فشل الاتصال بالخادم. تحقق من اتصالك بالإنترنت.' };
          }
          throw fetchError;
        }
      }
    } catch (error: any) {
      console.error('Import error:', error);
      console.error('Error response:', error.response?.data);
      console.error('Error message:', error.message);
      
      // Ensure error message is always a string
      let errorMessage = 'فشل في استيراد البيانات';
      
      // Check for custom message from our XHR handler
      if (error.message && typeof error.message === 'string') {
        errorMessage = error.message;
      } else if (error.response?.data?.detail) {
        if (typeof error.response.data.detail === 'string') {
          errorMessage = error.response.data.detail;
        } else if (Array.isArray(error.response.data.detail)) {
          errorMessage = error.response.data.detail.map((e: any) => e.msg || String(e)).join('\n');
        } else {
          errorMessage = JSON.stringify(error.response.data.detail);
        }
      } else if (error.response?.data) {
        errorMessage = JSON.stringify(error.response.data);
      }
      
      // Add network error hint
      if (errorMessage === 'فشل في استيراد البيانات' || errorMessage.includes('Network')) {
        errorMessage = 'خطأ في الاتصال بالخادم. تأكد من اتصالك بالإنترنت وأعد المحاولة.';
      }
      
      Alert.alert('خطأ', errorMessage);
    } finally {
      setImporting(false);
    }
  };

  // تحميل قالب Excel
  const handleDownloadTemplate = async () => {
    try {
      const response = await exportAPI.getStudentsTemplate();
      // For web, create download link
      if (Platform.OS === 'web') {
        const url = window.URL.createObjectURL(response.data);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'students_template.xlsx';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
      Alert.alert('نجاح', 'تم تحميل القالب');
    } catch (error) {
      Alert.alert('خطأ', 'فشل في تحميل القالب');
    }
  };

  // تفعيل حساب الطالب
  const handleActivateAccount = async (student: Student) => {
    const message = `هل تريد تفعيل حساب للطالب ${student.full_name}؟\n\nبيانات الدخول:\n• اسم المستخدم: ${student.student_id}\n• كلمة المرور: ${student.student_id}\n\n⚠️ سيُطلب من الطالب تغيير كلمة المرور عند أول دخول`;
    
    showConfirm('تفعيل حساب', message, async () => {
      try {
        console.log('Activating account for student:', student.id);
        const response = await studentsAPI.activateAccount(student.id);
        console.log('Activation response:', response.data);
        showMessage('تم التفعيل بنجاح ✅', `تم تفعيل حساب الطالب\n\nاسم المستخدم: ${response.data.username}\nكلمة المرور: ${student.student_id}`);
        fetchData();
      } catch (error: any) {
        console.error('Activation error:', error.response?.data || error.message);
        const errorMsg = error.response?.data?.detail || 'فشل في تفعيل الحساب';
        showMessage('خطأ', errorMsg);
      }
    }, 'تفعيل');
  };

  // إلغاء تفعيل حساب الطالب
  const handleDeactivateAccount = async (student: Student) => {
    const message = `هل أنت متأكد من إلغاء تفعيل حساب ${student.full_name}؟\n\nلن يتمكن الطالب من الدخول للنظام بعد ذلك.`;
    
    showConfirm('إلغاء تفعيل الحساب', message, async () => {
      try {
        console.log('Deactivating account for student:', student.id);
        const response = await studentsAPI.deactivateAccount(student.id);
        console.log('Deactivation response:', response.data);
        showMessage('تم', 'تم إلغاء تفعيل حساب الطالب');
        fetchData();
      } catch (error: any) {
        console.error('Deactivation error:', error.response?.data || error.message);
        const errorMsg = error.response?.data?.detail || 'فشل في إلغاء التفعيل';
        showMessage('خطأ', errorMsg);
      }
    }, 'إلغاء التفعيل', true);
  };

  // إعادة تعيين كلمة مرور الطالب
  const handleResetPassword = (student: Student) => {
    const message = `هل تريد إعادة تعيين كلمة مرور ${student.full_name}؟\n\nستصبح كلمة المرور الجديدة: ${student.student_id}`;
    
    showConfirm('إعادة تعيين كلمة المرور', message, async () => {
      try {
        const response = await studentsAPI.resetPassword(student.id);
        showMessage('تم ✅', `تم إعادة تعيين كلمة المرور\n\nكلمة المرور الجديدة: ${student.student_id}`);
      } catch (error: any) {
        const errorMsg = error.response?.data?.detail || 'فشل في إعادة تعيين كلمة المرور';
        showMessage('خطأ', errorMsg);
      }
    });
  };

  const handleDelete = (studentId: string, studentName: string) => {
    showConfirm('حذف الطالب', `هل أنت متأكد من حذف ${studentName}؟`, async () => {
      try {
        await studentsAPI.delete(studentId);
        showMessage('تم', 'تم حذف الطالب بنجاح');
        fetchData();
      } catch (error) {
        showMessage('خطأ', 'فشل في حذف الطالب');
      }
    }, 'حذف', true);
  };

  const getDepartmentName = (deptId: string) => {
    const dept = departments.find(d => d.id === deptId);
    return dept?.name || 'غير محدد';
  };

  const renderStudent = ({ item }: { item: Student }) => (
    <TouchableOpacity 
      style={[styles.itemCard, selectedIds.has(item.id) && styles.itemCardSelected]}
      onPress={() => selectionMode ? toggleSelect(item.id) : null}
      onLongPress={() => {
        if (!selectionMode) {
          setSelectionMode(true);
          setSelectedIds(new Set([item.id]));
        }
      }}
      activeOpacity={selectionMode ? 0.7 : 1}
    >
      {selectionMode && (
        <TouchableOpacity 
          style={styles.checkbox}
          onPress={() => toggleSelect(item.id)}
        >
          <Ionicons 
            name={selectedIds.has(item.id) ? "checkbox" : "square-outline"} 
            size={24} 
            color={selectedIds.has(item.id) ? "#1565c0" : "#999"} 
          />
        </TouchableOpacity>
      )}
      <View style={styles.itemInfo}>
        <Text style={styles.itemName}>{item.full_name}</Text>
        <Text style={styles.itemDetail}>{item.student_id}</Text>
        <Text style={styles.itemDetail}>
          {getDepartmentName(item.department_id)} | م{item.level} {item.section ? `| ${item.section}` : ''}
        </Text>
      </View>
      {!selectionMode && (
        <View style={styles.actionButtons}>
          {/* زر تفعيل/إلغاء تفعيل الحساب */}
          {canEdit && (
            <TouchableOpacity
              style={[styles.accountBtn, item.user_id ? styles.accountBtnActive : styles.accountBtnInactive]}
              onPress={() => item.user_id ? handleDeactivateAccount(item) : handleActivateAccount(item)}
            >
              <Ionicons 
                name={item.user_id ? "person-remove" : "person-add"} 
                size={18} 
                color={item.user_id ? "#f44336" : "#4caf50"} 
              />
            </TouchableOpacity>
          )}
          {/* زر إعادة كلمة المرور - يظهر فقط للحسابات المفعلة */}
          {canEdit && item.user_id && (
            <TouchableOpacity
              style={styles.resetPwdBtn}
              onPress={() => handleResetPassword(item)}
            >
              <Ionicons name="key" size={18} color="#ff9800" />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.cardBtn}
            onPress={() => router.push({
              pathname: '/student-card',
              params: { studentId: item.id }
            })}
          >
            <Ionicons name="card" size={20} color="#1565c0" />
          </TouchableOpacity>
          {canEdit && (
            <TouchableOpacity
              style={styles.editBtn}
              onPress={() => handleEdit(item)}
            >
              <Ionicons name="create" size={20} color="#ff9800" />
            </TouchableOpacity>
          )}
          {canDelete && (
            <TouchableOpacity
              style={styles.deleteBtn}
              onPress={() => handleDelete(item.id, item.full_name)}
            >
              <Ionicons name="trash" size={20} color="#f44336" />
            </TouchableOpacity>
          )}
        </View>
      )}
    </TouchableOpacity>
  );

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
              {editingStudent ? 'تعديل بيانات الطالب' : 'إضافة طالب جديد'}
            </Text>
            
            <Text style={styles.label}>رقم الطالب *</Text>
            <TextInput
              style={[styles.input, editingStudent && styles.inputDisabled]}
              value={formData.student_id}
              onChangeText={(text) => setFormData({ ...formData, student_id: text })}
              placeholder="أدخل رقم الطالب"
              editable={!editingStudent}
            />

            <Text style={styles.label}>الاسم الكامل *</Text>
            <TextInput
              style={styles.input}
              value={formData.full_name}
              onChangeText={(text) => setFormData({ ...formData, full_name: text })}
              placeholder="أدخل الاسم الكامل"
            />

            <Text style={styles.label}>القسم *</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.optionsRow}>
              {departments.map(dept => (
                <TouchableOpacity
                  key={dept.id}
                  style={[
                    styles.optionBtn,
                    formData.department_id === dept.id && styles.optionBtnActive
                  ]}
                  onPress={() => setFormData({ ...formData, department_id: dept.id })}
                >
                  <Text style={[
                    styles.optionText,
                    formData.department_id === dept.id && styles.optionTextActive
                  ]}>{dept.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.label}>المستوى *</Text>
            <View style={styles.optionsRow}>
              {LEVELS.map(level => (
                <TouchableOpacity
                  key={level}
                  style={[
                    styles.optionBtn,
                    formData.level === level && styles.optionBtnActive
                  ]}
                  onPress={() => setFormData({ ...formData, level })}
                >
                  <Text style={[
                    styles.optionText,
                    formData.level === level && styles.optionTextActive
                  ]}>{level}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>الشعبة (اختياري)</Text>
            <TextInput
              style={styles.input}
              value={formData.section}
              onChangeText={(text) => setFormData({ ...formData, section: text })}
              placeholder="مثال: A أو B"
            />

            <Text style={styles.label}>رقم الهاتف</Text>
            <TextInput
              style={styles.input}
              value={formData.phone}
              onChangeText={(text) => setFormData({ ...formData, phone: text })}
              placeholder="رقم الهاتف"
              keyboardType="phone-pad"
            />

            <Text style={styles.label}>كلمة المرور {editingStudent ? '' : '(لإنشاء حساب)'}</Text>
            <TextInput
              style={styles.input}
              value={formData.password}
              onChangeText={(text) => setFormData({ ...formData, password: text })}
              placeholder={editingStudent ? 'اتركها فارغة للإبقاء على القديمة' : 'اختياري'}
              secureTextEntry
            />

            <View style={styles.formButtons}>
              <TouchableOpacity
                style={[styles.btn, styles.cancelBtn]}
                onPress={() => {
                  setShowForm(false);
                  setEditingStudent(null);
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
                  {saving ? 'جاري الحفظ...' : editingStudent ? 'تحديث' : 'حفظ'}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        ) : (
          <>
            {/* شريط الحذف المتعدد */}
            {selectionMode && (
              <View style={styles.bulkActionBar}>
                <View style={styles.bulkActionLeft}>
                  <TouchableOpacity onPress={toggleSelectionMode} style={styles.bulkActionClose}>
                    <Ionicons name="close" size={24} color="#333" />
                  </TouchableOpacity>
                  <Text style={styles.bulkActionText}>
                    تم تحديد {selectedIds.size} عنصر
                  </Text>
                </View>
                <View style={styles.bulkActionRight}>
                  <TouchableOpacity onPress={selectAll} style={styles.bulkActionBtn}>
                    <Ionicons name="checkbox-outline" size={20} color="#1565c0" />
                    <Text style={styles.bulkActionBtnText}>تحديد الكل</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    onPress={handleBulkDelete} 
                    style={[styles.bulkActionBtn, styles.bulkDeleteBtn]}
                    disabled={selectedIds.size === 0 || deleting}
                  >
                    {deleting ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Ionicons name="trash" size={20} color="#fff" />
                    )}
                    <Text style={styles.bulkDeleteBtnText}>حذف</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* أزرار الإجراءات */}
            <View style={styles.actionsContainer}>
              {canEdit && (
                <TouchableOpacity
                  style={styles.addButton}
                  onPress={() => setShowForm(true)}
                >
                  <Ionicons name="add-circle" size={22} color="#fff" />
                  <Text style={styles.addButtonText}>إضافة طالب</Text>
                </TouchableOpacity>
              )}

              {canDelete && (
                <TouchableOpacity
                  style={[styles.addButton, styles.selectButton]}
                  onPress={toggleSelectionMode}
                >
                  <Ionicons name={selectionMode ? "close" : "checkmark-circle"} size={22} color="#fff" />
                  <Text style={styles.addButtonText}>{selectionMode ? 'إلغاء' : 'تحديد'}</Text>
                </TouchableOpacity>
              )}

              {canImport && (
                <TouchableOpacity
                  style={[styles.addButton, importMode ? styles.cancelButton : styles.importButton]}
                  onPress={() => {
                    if (importMode) {
                      setImportMode(false);
                    } else {
                      setImportMode(true);
                    }
                  }}
                >
                  <Ionicons name={importMode ? "close" : "cloud-upload"} size={22} color="#fff" />
                  <Text style={styles.addButtonText}>{importMode ? 'إلغاء' : 'استيراد'}</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* وضع الاستيراد */}
            {importMode && canImport && (
              <View style={styles.importSettingsContainer}>
                <Text style={styles.importSettingsTitle}>📥 إعدادات الاستيراد:</Text>
                
                {/* القوائم المنسدلة في صف واحد */}
                <View style={styles.dropdownRow}>
                  <View style={styles.dropdownContainer}>
                    <Text style={styles.dropdownLabel}>القسم *</Text>
                    <View style={styles.pickerWrapper}>
                      <Picker
                        selectedValue={importDept}
                        onValueChange={(value) => setImportDept(value)}
                        style={styles.picker}
                      >
                        <Picker.Item label="اختر القسم..." value="" />
                        {departments.map(dept => (
                          <Picker.Item key={dept.id} label={dept.name} value={dept.id} />
                        ))}
                      </Picker>
                    </View>
                  </View>
                  
                  <View style={styles.dropdownContainer}>
                    <Text style={styles.dropdownLabel}>المستوى</Text>
                    <View style={styles.pickerWrapper}>
                      <Picker
                        selectedValue={importLevel}
                        onValueChange={(value) => setImportLevel(value)}
                        style={styles.picker}
                      >
                        {LEVELS.map(level => (
                          <Picker.Item key={level} label={`م${level}`} value={level} />
                        ))}
                      </Picker>
                    </View>
                  </View>
                  
                  <View style={styles.dropdownContainer}>
                    <Text style={styles.dropdownLabel}>الشعبة</Text>
                    <TextInput
                      style={styles.dropdownInput}
                      value={importSection}
                      onChangeText={setImportSection}
                      placeholder="اختياري"
                    />
                  </View>
                </View>
                
                <View style={styles.importButtonsRow}>
                  <TouchableOpacity 
                    style={[styles.importActionBtn, !importDept && styles.importButtonDisabled]} 
                    onPress={handleImportExcel}
                    disabled={importing || !importDept}
                  >
                    {importing ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Ionicons name="cloud-upload" size={20} color="#fff" />
                    )}
                    <Text style={styles.importActionBtnText}>رفع ملف Excel</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity style={styles.templateActionBtn} onPress={handleDownloadTemplate}>
                    <Ionicons name="download-outline" size={20} color="#1565c0" />
                    <Text style={styles.templateActionBtnText}>تحميل القالب</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* وضع عرض الطلاب - يظهر عندما لا يكون في وضع الاستيراد */}
            {!importMode && (
              <>
                {/* حقل البحث */}
                <View style={styles.searchContainer}>
                  <Ionicons name="search" size={20} color="#999" style={styles.searchIcon} />
                  <TextInput
                    style={styles.searchInput}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder="بحث بالاسم أو رقم الطالب..."
                    placeholderTextColor="#999"
                  />
                  {searchQuery.length > 0 && (
                    <TouchableOpacity onPress={() => setSearchQuery('')}>
                      <Ionicons name="close-circle" size={20} color="#999" />
                    </TouchableOpacity>
                  )}
                </View>

                {/* فلاتر عرض الطلاب - قوائم منسدلة */}
                <View style={styles.filterContainer}>
                  <View style={styles.dropdownRow}>
                    <View style={styles.dropdownContainer}>
                      <Text style={styles.dropdownLabel}>القسم</Text>
                      <View style={styles.pickerWrapper}>
                        <Picker
                          selectedValue={selectedDeptFilter}
                          onValueChange={(value) => setSelectedDeptFilter(value)}
                          style={styles.picker}
                        >
                          <Picker.Item label="الكل" value="" />
                          {departments.map(dept => (
                            <Picker.Item key={dept.id} label={dept.name} value={dept.id} />
                          ))}
                        </Picker>
                      </View>
                    </View>
                    
                    <View style={styles.dropdownContainer}>
                      <Text style={styles.dropdownLabel}>المستوى</Text>
                      <View style={styles.pickerWrapper}>
                        <Picker
                          selectedValue={selectedLevelFilter}
                          onValueChange={(value) => setSelectedLevelFilter(value)}
                          style={styles.picker}
                        >
                          <Picker.Item label="الكل" value="" />
                          {LEVELS.map(level => (
                            <Picker.Item key={level} label={`م${level}`} value={level} />
                          ))}
                        </Picker>
                      </View>
                    </View>
                    
                    <View style={styles.dropdownContainer}>
                      <Text style={styles.dropdownLabel}>الشعبة</Text>
                      <TextInput
                        style={styles.dropdownInput}
                        value={selectedSectionFilter}
                        onChangeText={setSelectedSectionFilter}
                        placeholder="الكل"
                      />
                    </View>
                  </View>
                </View>

                {/* عداد الطلاب */}
                <View style={styles.studentsCountContainer}>
                  <Text style={styles.studentsCountText}>
                    عدد الطلاب: {filteredStudents.length} من {students.length}
                  </Text>
                </View>

                <FlatList
                  data={filteredStudents}
                  renderItem={renderStudent}
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={styles.listContent}
                  ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                      <Ionicons name="people-outline" size={64} color="#ccc" />
                      <Text style={styles.emptyText}>
                        {searchQuery ? 'لا توجد نتائج للبحث' : 'لا يوجد طلاب'}
                      </Text>
                    </View>
                  }
                />
              </>
            )}
          </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  bulkActionBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#e3f2fd',
    padding: 12,
    paddingHorizontal: 16,
  },
  bulkActionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  bulkActionClose: {
    padding: 4,
  },
  bulkActionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1565c0',
  },
  bulkActionRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bulkActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    gap: 4,
  },
  bulkActionBtnText: {
    fontSize: 13,
    color: '#1565c0',
  },
  bulkDeleteBtn: {
    backgroundColor: '#f44336',
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  bulkDeleteBtnText: {
    fontSize: 13,
    color: '#fff',
  },
  actionsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 8,
  },
  addButton: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#1565c0',
    padding: 12,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectButton: {
    backgroundColor: '#607d8b',
    flex: 0.6,
  },
  importButton: {
    backgroundColor: '#ff9800',
  },
  cancelButton: {
    backgroundColor: '#f44336',
  },
  importButtonDisabled: {
    backgroundColor: '#ccc',
  },
  importButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  importActionBtn: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#4caf50',
    padding: 12,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  importActionBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  templateActionBtn: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#e3f2fd',
    padding: 12,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#1565c0',
  },
  templateActionBtnText: {
    color: '#1565c0',
    fontSize: 14,
    fontWeight: '600',
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
  dropdownInput: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    paddingHorizontal: 10,
    paddingVertical: 12,
    fontSize: 13,
    height: 45,
  },
  addButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
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
    paddingVertical: 10,
    fontSize: 14,
    color: '#333',
  },
  filterContainer: {
    padding: 10,
    backgroundColor: '#f8f9fa',
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 10,
  },
  filterSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  filterLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
    marginTop: 4,
  },
  filterScroll: {
    marginBottom: 4,
  },
  sectionFilterInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    marginBottom: 4,
  },
  importSettingsContainer: {
    backgroundColor: '#fff3e0',
    padding: 16,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ffcc80',
  },
  studentsCountContainer: {
    backgroundColor: '#e3f2fd',
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    marginBottom: 8,
    marginTop: 8,
    borderRadius: 8,
  },
  studentsCountText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1565c0',
    textAlign: 'center',
  },
  filterBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#fff',
    borderRadius: 16,
    marginRight: 6,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  filterBtnActive: {
    backgroundColor: '#1565c0',
    borderColor: '#1565c0',
  },
  filterText: {
    fontSize: 12,
    color: '#333',
  },
  filterTextActive: {
    color: '#fff',
  },
  sectionInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 12,
  },
  sectionInput: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#ddd',
    fontSize: 14,
  },
  templateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  templateBtnText: {
    fontSize: 13,
    color: '#1565c0',
    marginLeft: 4,
  },
  importSettings: {
    backgroundColor: '#e3f2fd',
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
  },
  importSettingsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1565c0',
    marginBottom: 10,
  },
  importRow: {
    flexDirection: 'column',
    marginBottom: 12,
  },
  importLabel: {
    fontSize: 13,
    color: '#333',
    marginBottom: 6,
    fontWeight: '500',
  },
  levelButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  levelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
    marginBottom: 4,
  },
  levelBtnActive: {
    backgroundColor: '#1565c0',
    borderColor: '#1565c0',
  },
  levelBtnText: {
    fontSize: 13,
    color: '#333',
  },
  levelBtnTextActive: {
    color: '#fff',
  },
  importSectionInput: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#ddd',
    fontSize: 14,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  itemCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  itemCardSelected: {
    backgroundColor: '#e3f2fd',
    borderColor: '#1565c0',
    borderWidth: 2,
  },
  checkbox: {
    marginRight: 12,
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  itemDetail: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  deleteBtn: {
    padding: 8,
  },
  editBtn: {
    padding: 8,
    backgroundColor: '#fff3e0',
    borderRadius: 8,
  },
  resetPwdBtn: {
    padding: 8,
    backgroundColor: '#fff3e0',
    borderRadius: 8,
  },
  inputDisabled: {
    backgroundColor: '#f5f5f5',
    color: '#999',
  },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardBtn: {
    padding: 8,
    backgroundColor: '#e3f2fd',
    borderRadius: 8,
  },
  accountBtn: {
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  accountBtnActive: {
    backgroundColor: '#ffebee',
    borderColor: '#f44336',
  },
  accountBtnInactive: {
    backgroundColor: '#e8f5e9',
    borderColor: '#4caf50',
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
});
