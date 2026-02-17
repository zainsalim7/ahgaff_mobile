import React, { useState, useEffect, useCallback } from 'react';
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
import { departmentsAPI, facultiesAPI } from '../src/services/api';
import { Department } from '../src/types';
import { LoadingScreen } from '../src/components/LoadingScreen';
import { useAuth, PERMISSIONS } from '../src/contexts/AuthContext';

interface Faculty {
  id: string;
  name: string;
  code: string;
}

interface DeptStats extends Department {
  students_count: number;
  courses_count: number;
  faculty_id?: string;
  faculty_name?: string;
}

interface DeptDetails {
  id: string;
  name: string;
  code: string;
  description: string;
  faculty_id?: string;
  faculty_name?: string;
  students_count: number;
  courses_count: number;
  teachers_count: number;
  students: Array<{ id: string; student_id: string; full_name: string; level: number; section: string }>;
  courses: Array<{ id: string; name: string; code: string; level: number; section: string; teacher_name: string; students_count: number }>;
  teachers: Array<{ id: string; full_name: string; username: string }>;
}

export default function AddDepartmentScreen() {
  const [departments, setDepartments] = useState<DeptStats[]>([]);
  const [faculties, setFaculties] = useState<Faculty[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  
  // صلاحيات
  const { hasPermission } = useAuth();
  const canManageDepts = hasPermission(PERMISSIONS.MANAGE_DEPARTMENTS);
  
  // Details modal
  const [selectedDept, setSelectedDept] = useState<DeptDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailsTab, setDetailsTab] = useState<'students' | 'courses' | 'teachers'>('students');

  // Filter by faculty
  const [filterFacultyId, setFilterFacultyId] = useState<string>('');

  const [formData, setFormData] = useState({
    name: '',
    code: '',
    description: '',
    faculty_id: '',
  });

  const fetchData = useCallback(async () => {
    try {
      const [deptsRes, facultiesRes] = await Promise.all([
        departmentsAPI.getStats(),
        facultiesAPI.getAll(),
      ]);
      setDepartments(deptsRes.data);
      setFaculties(facultiesRes.data || []);
    } catch (error) {
      console.error('Error fetching data:', error);
      // Fallback to regular getAll
      try {
        const fallback = await departmentsAPI.getAll();
        setDepartments(fallback.data.map((d: Department) => ({ ...d, students_count: 0, courses_count: 0 })));
      } catch (e) {
        console.error('Fallback error:', e);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleShowDetails = async (deptId: string) => {
    setLoadingDetails(true);
    setDetailsTab('students');
    try {
      const response = await departmentsAPI.getDetails(deptId);
      setSelectedDept(response.data);
    } catch (error) {
      console.error('Error fetching department details:', error);
      Alert.alert('خطأ', 'فشل في تحميل تفاصيل القسم');
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleSubmit = async () => {
    if (!formData.name || !formData.code) {
      Alert.alert('خطأ', 'الرجاء ملء جميع الحقول المطلوبة');
      return;
    }

    setSaving(true);
    try {
      if (editingDept) {
        await departmentsAPI.update(editingDept.id, formData);
        Alert.alert('نجاح', 'تم تحديث القسم بنجاح');
      } else {
        await departmentsAPI.create(formData);
        Alert.alert('نجاح', 'تم إضافة القسم بنجاح');
      }
      resetForm();
      setShowForm(false);
      setEditingDept(null);
      fetchData();
    } catch (error: any) {
      const message = error.response?.data?.detail || 'حدث خطأ';
      Alert.alert('خطأ', message);
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setFormData({ name: '', code: '', description: '', faculty_id: '' });
  };

  const handleEdit = (dept: DeptStats) => {
    setEditingDept(dept);
    setFormData({
      name: dept.name,
      code: dept.code,
      description: dept.description || '',
      faculty_id: dept.faculty_id || '',
    });
    setShowForm(true);
  };

  const handleDelete = (deptId: string, deptName: string) => {
    Alert.alert(
      'حذف القسم',
      `هل أنت متأكد من حذف قسم ${deptName}؟`,
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'حذف',
          style: 'destructive',
          onPress: async () => {
            try {
              await departmentsAPI.delete(deptId);
              fetchData();
            } catch (error) {
              Alert.alert('خطأ', 'فشل في حذف القسم');
            }
          },
        },
      ]
    );
  };

  const renderDepartment = ({ item }: { item: DeptStats }) => (
    <TouchableOpacity 
      style={styles.itemCard}
      onPress={() => handleShowDetails(item.id)}
      activeOpacity={0.7}
    >
      <View style={styles.itemIcon}>
        <Ionicons name="business" size={24} color="#e91e63" />
      </View>
      <View style={styles.itemInfo}>
        <Text style={styles.itemName}>{item.name}</Text>
        <Text style={styles.itemDetail}>{item.code}</Text>
        <View style={styles.statsRow}>
          <View style={styles.statBadge}>
            <Ionicons name="people" size={14} color="#1565c0" />
            <Text style={styles.statText}>{item.students_count} طالب</Text>
          </View>
          <View style={styles.statBadge}>
            <Ionicons name="book" size={14} color="#4caf50" />
            <Text style={styles.statText}>{item.courses_count} مقرر</Text>
          </View>
        </View>
      </View>
      {canManageDepts && (
        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={styles.editBtn}
            onPress={(e) => { e.stopPropagation(); handleEdit(item); }}
          >
            <Ionicons name="create" size={20} color="#ff9800" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.deleteBtn}
            onPress={(e) => { e.stopPropagation(); handleDelete(item.id, item.name); }}
          >
            <Ionicons name="trash" size={20} color="#f44336" />
          </TouchableOpacity>
        </View>
      )}
    </TouchableOpacity>
  );

  // Details Modal Content
  const renderDetailsModal = () => (
    <Modal
      visible={selectedDept !== null}
      animationType="slide"
      transparent
      onRequestClose={() => setSelectedDept(null)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          {loadingDetails ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#e91e63" />
              <Text style={styles.loadingText}>جاري التحميل...</Text>
            </View>
          ) : selectedDept && (
            <>
              {/* Header */}
              <View style={styles.modalHeader}>
                <TouchableOpacity onPress={() => setSelectedDept(null)}>
                  <Ionicons name="close" size={28} color="#333" />
                </TouchableOpacity>
                <Text style={styles.modalTitle}>{selectedDept.name}</Text>
                <View style={{ width: 28 }} />
              </View>
              
              {/* Stats Summary */}
              <View style={styles.summaryRow}>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryNumber}>{selectedDept.students_count}</Text>
                  <Text style={styles.summaryLabel}>طالب</Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryNumber}>{selectedDept.courses_count}</Text>
                  <Text style={styles.summaryLabel}>مقرر</Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryNumber}>{selectedDept.teachers_count}</Text>
                  <Text style={styles.summaryLabel}>مدرس</Text>
                </View>
              </View>
              
              {/* Tabs */}
              <View style={styles.tabsRow}>
                <TouchableOpacity 
                  style={[styles.tab, detailsTab === 'students' && styles.tabActive]}
                  onPress={() => setDetailsTab('students')}
                >
                  <Ionicons name="people" size={18} color={detailsTab === 'students' ? '#fff' : '#666'} />
                  <Text style={[styles.tabText, detailsTab === 'students' && styles.tabTextActive]}>الطلاب</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.tab, detailsTab === 'courses' && styles.tabActive]}
                  onPress={() => setDetailsTab('courses')}
                >
                  <Ionicons name="book" size={18} color={detailsTab === 'courses' ? '#fff' : '#666'} />
                  <Text style={[styles.tabText, detailsTab === 'courses' && styles.tabTextActive]}>المقررات</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.tab, detailsTab === 'teachers' && styles.tabActive]}
                  onPress={() => setDetailsTab('teachers')}
                >
                  <Ionicons name="school" size={18} color={detailsTab === 'teachers' ? '#fff' : '#666'} />
                  <Text style={[styles.tabText, detailsTab === 'teachers' && styles.tabTextActive]}>المدرسين</Text>
                </TouchableOpacity>
              </View>
              
              {/* Content */}
              <ScrollView style={styles.modalBody}>
                {detailsTab === 'students' && (
                  selectedDept.students.length === 0 ? (
                    <Text style={styles.emptyListText}>لا يوجد طلاب في هذا القسم</Text>
                  ) : (
                    selectedDept.students.map(student => (
                      <View key={student.id} style={styles.listItem}>
                        <View style={styles.listItemIcon}>
                          <Ionicons name="person" size={20} color="#1565c0" />
                        </View>
                        <View style={styles.listItemInfo}>
                          <Text style={styles.listItemName}>{student.full_name}</Text>
                          <Text style={styles.listItemDetail}>
                            {student.student_id} | م{student.level} {student.section && `| ${student.section}`}
                          </Text>
                        </View>
                      </View>
                    ))
                  )
                )}
                
                {detailsTab === 'courses' && (
                  selectedDept.courses.length === 0 ? (
                    <Text style={styles.emptyListText}>لا توجد مقررات في هذا القسم</Text>
                  ) : (
                    selectedDept.courses.map(course => (
                      <View key={course.id} style={styles.listItem}>
                        <View style={[styles.listItemIcon, { backgroundColor: '#e8f5e9' }]}>
                          <Ionicons name="book" size={20} color="#4caf50" />
                        </View>
                        <View style={styles.listItemInfo}>
                          <Text style={styles.listItemName}>{course.name}</Text>
                          <Text style={styles.listItemDetail}>
                            م{course.level} {course.section && `| ${course.section}`} | {course.students_count} طالب
                          </Text>
                          {course.teacher_name && (
                            <Text style={styles.listItemTeacher}>المدرس: {course.teacher_name}</Text>
                          )}
                        </View>
                      </View>
                    ))
                  )
                )}
                
                {detailsTab === 'teachers' && (
                  selectedDept.teachers.length === 0 ? (
                    <Text style={styles.emptyListText}>لا يوجد مدرسين في هذا القسم</Text>
                  ) : (
                    selectedDept.teachers.map(teacher => (
                      <View key={teacher.id} style={styles.listItem}>
                        <View style={[styles.listItemIcon, { backgroundColor: '#fff3e0' }]}>
                          <Ionicons name="school" size={20} color="#ff9800" />
                        </View>
                        <View style={styles.listItemInfo}>
                          <Text style={styles.listItemName}>{teacher.full_name}</Text>
                          <Text style={styles.listItemDetail}>@{teacher.username}</Text>
                        </View>
                      </View>
                    ))
                  )
                )}
              </ScrollView>
            </>
          )}
        </View>
      </View>
    </Modal>
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
              {editingDept ? 'تعديل القسم' : 'إضافة قسم جديد'}
            </Text>
            
            {/* اختيار الكلية */}
            <Text style={styles.label}>الكلية *</Text>
            <View style={styles.facultySelector}>
              {faculties.length > 0 ? (
                faculties.map(faculty => (
                  <TouchableOpacity
                    key={faculty.id}
                    style={[
                      styles.facultyOption,
                      formData.faculty_id === faculty.id && styles.facultyOptionActive
                    ]}
                    onPress={() => setFormData({ ...formData, faculty_id: faculty.id })}
                  >
                    <Text style={[
                      styles.facultyOptionText,
                      formData.faculty_id === faculty.id && styles.facultyOptionTextActive
                    ]}>
                      {faculty.name}
                    </Text>
                  </TouchableOpacity>
                ))
              ) : (
                <Text style={styles.noDataText}>لا توجد كليات - أضف كليات أولاً</Text>
              )}
            </View>
            
            <Text style={styles.label}>اسم القسم *</Text>
            <TextInput
              style={styles.input}
              value={formData.name}
              onChangeText={(text) => setFormData({ ...formData, name: text })}
              placeholder="مثال: قسم الشريعة الإسلامية"
            />

            <Text style={styles.label}>رمز القسم *</Text>
            <TextInput
              style={styles.input}
              value={formData.code}
              onChangeText={(text) => setFormData({ ...formData, code: text })}
              placeholder="مثال: SHARIA"
              autoCapitalize="characters"
            />

            <Text style={styles.label}>الوصف</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={formData.description}
              onChangeText={(text) => setFormData({ ...formData, description: text })}
              placeholder="وصف مختصر للقسم"
              multiline
              numberOfLines={3}
            />

            <View style={styles.formButtons}>
              <TouchableOpacity
                style={[styles.btn, styles.cancelBtn]}
                onPress={() => {
                  setShowForm(false);
                  setEditingDept(null);
                  resetForm();
                }}
              >
                <Text style={styles.cancelBtnText}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.saveBtn]}
                onPress={handleSubmit}
                disabled={saving || !formData.faculty_id}
              >
                <Text style={styles.saveBtnText}>
                  {saving ? 'جاري الحفظ...' : editingDept ? 'تحديث' : 'حفظ'}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        ) : (
          <>
            {canManageDepts && (
              <TouchableOpacity
                style={styles.addButton}
                onPress={() => setShowForm(true)}
              >
                <Ionicons name="add-circle" size={24} color="#fff" />
                <Text style={styles.addButtonText}>إضافة قسم جديد</Text>
              </TouchableOpacity>
            )}

            <FlatList
              data={departments}
              renderItem={renderDepartment}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Ionicons name="business-outline" size={64} color="#ccc" />
                  <Text style={styles.emptyText}>لا توجد أقسام</Text>
                </View>
              }
            />
          </>
        )}
      </KeyboardAvoidingView>
      
      {renderDetailsModal()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  addButton: {
    flexDirection: 'row',
    backgroundColor: '#e91e63',
    margin: 16,
    padding: 16,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  // أنماط اختيار الكلية
  facultySelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  facultyOption: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  facultyOptionActive: {
    backgroundColor: '#e91e63',
    borderColor: '#e91e63',
  },
  facultyOptionText: {
    fontSize: 14,
    color: '#333',
  },
  facultyOptionTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  noDataText: {
    color: '#999',
    fontStyle: 'italic',
    padding: 16,
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
  itemIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#fce4ec',
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemInfo: {
    flex: 1,
    marginHorizontal: 12,
  },
  itemName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  itemDetail: {
    fontSize: 14,
    color: '#e91e63',
    marginTop: 2,
  },
  statsRow: {
    flexDirection: 'row',
    marginTop: 8,
    gap: 8,
  },
  statBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  statText: {
    fontSize: 12,
    color: '#666',
  },
  deleteBtn: {
    padding: 8,
  },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  editBtn: {
    padding: 8,
    backgroundColor: '#fff3e0',
    borderRadius: 8,
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
  textArea: {
    height: 100,
    textAlignVertical: 'top',
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
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
    minHeight: '60%',
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: '#666',
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
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: 20,
    backgroundColor: '#fce4ec',
  },
  summaryItem: {
    alignItems: 'center',
  },
  summaryNumber: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#e91e63',
  },
  summaryLabel: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  tabsRow: {
    flexDirection: 'row',
    padding: 12,
    gap: 8,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#f5f5f5',
    gap: 6,
  },
  tabActive: {
    backgroundColor: '#e91e63',
  },
  tabText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  tabTextActive: {
    color: '#fff',
  },
  modalBody: {
    flex: 1,
    padding: 12,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  listItemIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#e3f2fd',
    justifyContent: 'center',
    alignItems: 'center',
  },
  listItemInfo: {
    flex: 1,
    marginLeft: 12,
  },
  listItemName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  listItemDetail: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  listItemTeacher: {
    fontSize: 12,
    color: '#e91e63',
    marginTop: 4,
  },
  emptyListText: {
    textAlign: 'center',
    color: '#999',
    padding: 20,
    fontSize: 14,
  },
});
