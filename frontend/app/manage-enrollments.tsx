import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  RefreshControl,
  Alert,
  Platform,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { coursesAPI, studentsAPI, enrollmentAPI } from '../src/services/api';
import { LoadingScreen } from '../src/components/LoadingScreen';
import { useAuth, PERMISSIONS } from '../src/contexts/AuthContext';

/**
 * 📋 صفحة إدارة التسجيلات المستقلة
 *
 * الصلاحيات المطلوبة:
 *   - manage_enrollments OR view_enrollments → لعرض الصفحة
 *   - add_enrollment OR manage_enrollments → لإضافة تسجيل
 *   - delete_enrollment OR manage_enrollments → لإلغاء تسجيل
 */

interface Course {
  id: string;
  name: string;
  code?: string;
  department_id?: string;
  level?: number;
}

interface Student {
  id: string;
  full_name: string;
  reg_number?: string;
  department_id?: string;
  level?: number;
}

const showMessage = (title: string, message: string) => {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
};

export default function ManageEnrollmentsScreen() {
  const router = useRouter();
  const { hasPermission, hasAnyPermission } = useAuth();

  // 🔒 الصلاحيات
  const canView = hasAnyPermission([
    PERMISSIONS.MANAGE_ENROLLMENTS,
    'view_enrollments',
    'add_enrollment',
    'delete_enrollment',
  ]);
  const canAdd = hasAnyPermission([PERMISSIONS.MANAGE_ENROLLMENTS, 'add_enrollment']);
  const canDelete = hasAnyPermission([PERMISSIONS.MANAGE_ENROLLMENTS, 'delete_enrollment']);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const [enrolledStudents, setEnrolledStudents] = useState<Student[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string>('');
  const [showCoursePicker, setShowCoursePicker] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchCourse, setSearchCourse] = useState('');
  const [searchStudent, setSearchStudent] = useState('');
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);

  // 🔒 منع الوصول لمن لا يملك الصلاحية
  useEffect(() => {
    if (!canView) {
      showMessage('غير مصرح', 'ليس لديك صلاحية لعرض هذه الصفحة');
      router.replace('/' as any);
    }
  }, [canView, router]);

  const fetchInitialData = useCallback(async () => {
    try {
      const [coursesRes, studentsRes] = await Promise.allSettled([
        coursesAPI.getAll(),
        studentsAPI.getAll(),
      ]);
      if (coursesRes.status === 'fulfilled') setCourses(coursesRes.value.data || []);
      if (studentsRes.status === 'fulfilled') setAllStudents(studentsRes.value.data || []);
    } catch (err) {
      console.error('Error fetching initial data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const fetchEnrolled = useCallback(async (courseId: string) => {
    if (!courseId) {
      setEnrolledStudents([]);
      return;
    }
    try {
      const res = await enrollmentAPI.getEnrolledStudents(courseId);
      setEnrolledStudents(res.data || []);
    } catch (err) {
      console.error('Error fetching enrolled students:', err);
      setEnrolledStudents([]);
    }
  }, []);

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  useEffect(() => {
    if (selectedCourseId) {
      fetchEnrolled(selectedCourseId);
    }
  }, [selectedCourseId, fetchEnrolled]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchInitialData();
    if (selectedCourseId) fetchEnrolled(selectedCourseId);
  };

  const selectedCourse = useMemo(
    () => courses.find((c) => c.id === selectedCourseId) || null,
    [selectedCourseId, courses]
  );

  const filteredCourses = useMemo(() => {
    const q = searchCourse.trim().toLowerCase();
    if (!q) return courses;
    return courses.filter(
      (c) =>
        c.name?.toLowerCase().includes(q) ||
        c.code?.toLowerCase().includes(q)
    );
  }, [courses, searchCourse]);

  // الطلاب غير المسجلين في هذا المقرر (للإضافة)
  const enrolledIds = useMemo(() => new Set(enrolledStudents.map((s) => s.id)), [enrolledStudents]);
  const availableStudents = useMemo(() => {
    const list = allStudents.filter((s) => !enrolledIds.has(s.id));
    const q = searchStudent.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (s) =>
        s.full_name?.toLowerCase().includes(q) ||
        s.reg_number?.toLowerCase().includes(q)
    );
  }, [allStudents, enrolledIds, searchStudent]);

  const handleAddEnrollments = async () => {
    if (!selectedCourseId || selectedStudentIds.length === 0) return;
    setAdding(true);
    try {
      await enrollmentAPI.enroll(selectedCourseId, selectedStudentIds);
      showMessage('نجاح', `تم تسجيل ${selectedStudentIds.length} طالب بنجاح`);
      setShowAddModal(false);
      setSelectedStudentIds([]);
      setSearchStudent('');
      await fetchEnrolled(selectedCourseId);
    } catch (err: any) {
      const msg = err?.response?.data?.detail || 'فشل تسجيل الطلاب';
      showMessage('خطأ', msg);
    } finally {
      setAdding(false);
    }
  };

  const handleUnenroll = async (student: Student) => {
    const confirm =
      Platform.OS === 'web'
        ? window.confirm(`هل تريد إلغاء تسجيل "${student.full_name}" من هذا المقرر؟`)
        : await new Promise<boolean>((resolve) => {
            Alert.alert('تأكيد', `إلغاء تسجيل ${student.full_name}؟`, [
              { text: 'إلغاء', onPress: () => resolve(false) },
              { text: 'تأكيد', onPress: () => resolve(true), style: 'destructive' },
            ]);
          });
    if (!confirm) return;
    try {
      await enrollmentAPI.unenroll(selectedCourseId, student.id);
      await fetchEnrolled(selectedCourseId);
    } catch (err: any) {
      const msg = err?.response?.data?.detail || 'فشل إلغاء التسجيل';
      showMessage('خطأ', msg);
    }
  };

  if (loading) return <LoadingScreen />;
  if (!canView) return null;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ title: 'إدارة التسجيلات', headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-forward" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>إدارة التسجيلات</Text>
          <Text style={styles.headerSubtitle}>تسجيل الطلاب في المقررات وإلغاء التسجيل</Text>
        </View>
        <View style={styles.headerIcon}>
          <Ionicons name="clipboard" size={24} color="#fff" />
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* اختيار المقرر */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>اختر المقرر</Text>
          <TouchableOpacity
            style={styles.coursePicker}
            onPress={() => setShowCoursePicker(true)}
            data-testid="select-course-btn"
          >
            <View style={{ flex: 1 }}>
              {selectedCourse ? (
                <>
                  <Text style={styles.coursePickerText}>{selectedCourse.name}</Text>
                  {selectedCourse.code && (
                    <Text style={styles.coursePickerCode}>{selectedCourse.code}</Text>
                  )}
                </>
              ) : (
                <Text style={styles.coursePickerPlaceholder}>اضغط لاختيار مقرر...</Text>
              )}
            </View>
            <Ionicons name="chevron-down" size={20} color="#5b6678" />
          </TouchableOpacity>
        </View>

        {/* قائمة الطلاب المسجلين */}
        {selectedCourseId && (
          <View style={styles.section}>
            <View style={styles.listHeader}>
              <Text style={styles.sectionLabel}>
                الطلاب المسجلين ({enrolledStudents.length})
              </Text>
              {canAdd && (
                <TouchableOpacity
                  style={styles.addBtn}
                  onPress={() => setShowAddModal(true)}
                  data-testid="add-enrollment-btn"
                >
                  <Ionicons name="add" size={16} color="#fff" />
                  <Text style={styles.addBtnText}>تسجيل طلاب</Text>
                </TouchableOpacity>
              )}
            </View>

            {enrolledStudents.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="people-outline" size={48} color="#cfd6e1" />
                <Text style={styles.emptyText}>لا يوجد طلاب مسجلين في هذا المقرر</Text>
                {canAdd && (
                  <TouchableOpacity
                    style={[styles.addBtn, { marginTop: 12 }]}
                    onPress={() => setShowAddModal(true)}
                  >
                    <Ionicons name="add" size={16} color="#fff" />
                    <Text style={styles.addBtnText}>تسجيل أول طالب</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <View style={styles.studentsList}>
                {enrolledStudents.map((s) => (
                  <View key={s.id} style={styles.studentRow} data-testid={`student-row-${s.id}`}>
                    <View style={styles.studentAvatar}>
                      <Ionicons name="person" size={18} color="#1565c0" />
                    </View>
                    <View style={{ flex: 1, marginHorizontal: 10 }}>
                      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <Text style={styles.studentName}>{s.full_name}</Text>
                        {(s as any).cross_department && (
                          <View style={{ backgroundColor: '#fff3e0', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }} testID={`enroll-badge-cross-${s.id}`}>
                            <Text style={{ fontSize: 10, color: '#e65100', fontWeight: '800' }}>🔓 قسم آخر{(s as any).department_name ? ` — ${(s as any).department_name}` : ''}</Text>
                          </View>
                        )}
                        {(s as any).manual && !(s as any).cross_department && (
                          <View style={{ backgroundColor: '#e8f5e9', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }} testID={`enroll-badge-manual-${s.id}`}>
                            <Text style={{ fontSize: 10, color: '#2e7d32', fontWeight: '800' }}>✋ يدوي — محمي من المزامنة</Text>
                          </View>
                        )}
                      </View>
                      {s.reg_number && (
                        <Text style={styles.studentReg}>رقم القيد: {s.reg_number}</Text>
                      )}
                    </View>
                    {canDelete && (
                      <TouchableOpacity
                        style={styles.unenrollBtn}
                        onPress={() => handleUnenroll(s)}
                        data-testid={`unenroll-${s.id}`}
                      >
                        <Ionicons name="close-circle-outline" size={18} color="#f44336" />
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {!selectedCourseId && (
          <View style={styles.empty}>
            <Ionicons name="book-outline" size={64} color="#cfd6e1" />
            <Text style={styles.emptyText}>اختر مقرراً لعرض الطلاب المسجلين</Text>
          </View>
        )}
      </ScrollView>

      {/* Modal: اختيار المقرر */}
      <Modal visible={showCoursePicker} animationType="slide" transparent onRequestClose={() => setShowCoursePicker(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>اختر مقرراً</Text>
              <TouchableOpacity onPress={() => setShowCoursePicker(false)}>
                <Ionicons name="close" size={24} color="#1a1a2e" />
              </TouchableOpacity>
            </View>
            <View style={styles.modalSearch}>
              <Ionicons name="search" size={18} color="#8a95a8" />
              <TextInput
                style={styles.modalSearchInput}
                placeholder="بحث..."
                placeholderTextColor="#a8b1c2"
                value={searchCourse}
                onChangeText={setSearchCourse}
              />
            </View>
            <ScrollView style={styles.modalScroll}>
              {filteredCourses.length === 0 ? (
                <Text style={styles.emptyText}>لا توجد مقررات</Text>
              ) : (
                filteredCourses.map((c) => (
                  <TouchableOpacity
                    key={c.id}
                    style={[
                      styles.modalItem,
                      c.id === selectedCourseId && styles.modalItemActive,
                    ]}
                    onPress={() => {
                      setSelectedCourseId(c.id);
                      setShowCoursePicker(false);
                      setSearchCourse('');
                    }}
                  >
                    <Ionicons name="book" size={16} color="#1565c0" />
                    <View style={{ flex: 1, marginHorizontal: 10 }}>
                      <Text style={styles.modalItemTitle}>{c.name}</Text>
                      {c.code && <Text style={styles.modalItemSub}>{c.code}</Text>}
                    </View>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Modal: تسجيل طلاب */}
      <Modal visible={showAddModal} animationType="slide" transparent onRequestClose={() => setShowAddModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                تسجيل طلاب {selectedStudentIds.length > 0 && `(${selectedStudentIds.length})`}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setShowAddModal(false);
                  setSelectedStudentIds([]);
                  setSearchStudent('');
                }}
              >
                <Ionicons name="close" size={24} color="#1a1a2e" />
              </TouchableOpacity>
            </View>
            <View style={styles.modalSearch}>
              <Ionicons name="search" size={18} color="#8a95a8" />
              <TextInput
                style={styles.modalSearchInput}
                placeholder="ابحث عن طالب..."
                placeholderTextColor="#a8b1c2"
                value={searchStudent}
                onChangeText={setSearchStudent}
              />
            </View>
            <ScrollView style={styles.modalScroll}>
              {availableStudents.length === 0 ? (
                <Text style={styles.emptyText}>لا يوجد طلاب متاحون</Text>
              ) : (
                availableStudents.map((s) => {
                  const isSelected = selectedStudentIds.includes(s.id);
                  return (
                    <TouchableOpacity
                      key={s.id}
                      style={[styles.modalItem, isSelected && styles.modalItemActive]}
                      onPress={() => {
                        setSelectedStudentIds((prev) =>
                          isSelected ? prev.filter((id) => id !== s.id) : [...prev, s.id]
                        );
                      }}
                    >
                      <Ionicons
                        name={isSelected ? 'checkbox' : 'square-outline'}
                        size={20}
                        color={isSelected ? '#1565c0' : '#8a95a8'}
                      />
                      <View style={{ flex: 1, marginHorizontal: 10 }}>
                        <Text style={styles.modalItemTitle}>{s.full_name}</Text>
                        {s.reg_number && (
                          <Text style={styles.modalItemSub}>رقم القيد: {s.reg_number}</Text>
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => {
                  setShowAddModal(false);
                  setSelectedStudentIds([]);
                }}
              >
                <Text style={styles.modalCancelText}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalSaveBtn,
                  (selectedStudentIds.length === 0 || adding) && { opacity: 0.5 },
                ]}
                onPress={handleAddEnrollments}
                disabled={selectedStudentIds.length === 0 || adding}
                data-testid="confirm-add-enrollments"
              >
                <Text style={styles.modalSaveText}>
                  {adding ? 'جاري التسجيل...' : `تسجيل (${selectedStudentIds.length})`}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16 },

  header: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: '#1565c0',
    paddingHorizontal: 16,
    paddingVertical: 18,
    paddingTop: 50,
    gap: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#fff', textAlign: 'right' },
  headerSubtitle: { fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 2, textAlign: 'right' },

  section: { marginBottom: 16 },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1a1a2e',
    marginBottom: 10,
    textAlign: 'right',
  },

  coursePicker: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e3e7ee',
    gap: 10,
  },
  coursePickerText: { fontSize: 15, color: '#1a1a2e', fontWeight: '600', textAlign: 'right' },
  coursePickerCode: { fontSize: 12, color: '#5b6678', marginTop: 2, textAlign: 'right' },
  coursePickerPlaceholder: { fontSize: 14, color: '#a8b1c2', textAlign: 'right' },

  listHeader: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  addBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#1565c0',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  addBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  studentsList: { backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden' },
  studentRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eef1f5',
  },
  studentAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#e3f2fd',
    justifyContent: 'center',
    alignItems: 'center',
  },
  studentName: { fontSize: 14, fontWeight: '600', color: '#1a1a2e', textAlign: 'right' },
  studentReg: { fontSize: 11, color: '#5b6678', marginTop: 2, textAlign: 'right' },
  unenrollBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#ffebee',
    justifyContent: 'center',
    alignItems: 'center',
  },

  empty: { padding: 40, alignItems: 'center', backgroundColor: '#fff', borderRadius: 12 },
  emptyText: { fontSize: 13, color: '#8a95a8', marginTop: 8, textAlign: 'center', padding: 12 },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
    minHeight: 400,
  },
  modalHeader: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eef1f5',
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#1a1a2e' },
  modalSearch: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: '#f5f6f8',
    margin: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    gap: 8,
  },
  modalSearchInput: { flex: 1, fontSize: 14, color: '#1a1a2e', textAlign: 'right' },
  modalScroll: { flex: 1, paddingHorizontal: 12 },
  modalItem: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#f9fafc',
    borderRadius: 10,
    marginBottom: 6,
  },
  modalItemActive: { backgroundColor: '#e3f2fd' },
  modalItemTitle: { fontSize: 14, color: '#1a1a2e', fontWeight: '600', textAlign: 'right' },
  modalItemSub: { fontSize: 11, color: '#5b6678', marginTop: 2, textAlign: 'right' },
  modalFooter: {
    flexDirection: 'row-reverse',
    gap: 10,
    padding: 14,
    borderTopWidth: 1,
    borderTopColor: '#eef1f5',
  },
  modalCancelBtn: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#f5f6f8',
    alignItems: 'center',
  },
  modalCancelText: { color: '#5b6678', fontWeight: '700' },
  modalSaveBtn: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#1565c0',
    alignItems: 'center',
  },
  modalSaveText: { color: '#fff', fontWeight: '700' },
});
