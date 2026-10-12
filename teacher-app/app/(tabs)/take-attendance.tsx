import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Alert, Platform, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../src/store/authStore';
import { useOfflineSyncStore } from '../../src/store/offlineSyncStore';
import { coursesAPI, enrollmentsAPI } from '../../src/services/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LoadingScreen } from '../../src/components/LoadingScreen';

interface Student {
  id: string;
  student_id: string;
  full_name: string;
  status: 'present' | 'absent' | 'excused';
}

export default function TakeAttendanceScreen() {
  const user = useAuthStore((s) => s.user);
  const { addRecord, pendingRecords, loadPending } = useOfflineSyncStore();

  const [courses, setCourses] = useState<any[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<any>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const fetchCourses = useCallback(async () => {
    try {
      const res = await coursesAPI.getAll();
      const teacherCourses = res.data || [];
      setCourses(teacherCourses);
      // Cache courses for offline
      await AsyncStorage.setItem('cached_teacher_courses', JSON.stringify(teacherCourses));
    } catch {
      // Try offline cache
      const cached = await AsyncStorage.getItem('cached_teacher_courses');
      if (cached) setCourses(JSON.parse(cached));
    } finally { setLoading(false); setRefreshing(false); }
  }, [user]);

  useEffect(() => { loadPending(); fetchCourses(); }, []);

  const loadStudents = async (course: any) => {
    setSelectedCourse(course);
    setLoadingStudents(true);
    setSaved(false);
    try {
      const res = await enrollmentsAPI.getStudents(course.id);
      const studentList = (res.data || []).map((s: any) => ({ ...s, status: 'present' as const }));
      setStudents(studentList);
      await AsyncStorage.setItem(`cached_students_${course.id}`, JSON.stringify(studentList));
    } catch {
      const cached = await AsyncStorage.getItem(`cached_students_${course.id}`);
      if (cached) {
        setStudents(JSON.parse(cached).map((s: any) => ({ ...s, status: 'present' as const })));
      } else {
        setStudents([]);
      }
    } finally { setLoadingStudents(false); }
  };

  const toggleStatus = (studentId: string) => {
    setStudents(prev => prev.map(s => {
      if (s.id !== studentId) return s;
      // 📐 اللائحة: لا «معذور» من الأستاذ — العذر عبر طلب معتمد من الإدارة فقط
      const next = s.status === 'present' ? 'absent' : 'present';
      return { ...s, status: next };
    }));
  };

  const markAll = (status: 'present' | 'absent') => {
    setStudents(prev => prev.map(s => ({ ...s, status })));
  };

  const saveAttendance = async () => {
    if (!selectedCourse || students.length === 0) return;
    setSaving(true);
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

    try {
      await addRecord({
        course_id: selectedCourse.id,
        course_name: selectedCourse.name,
        lecture_date: dateStr,
        lecture_time: timeStr,
        students: students.map(s => ({ student_id: s.id, full_name: s.full_name, status: s.status })),
      });
      setSaved(true);
      const msg = `تم حفظ الحضور محلياً (${students.filter(s=>s.status==='present').length} حاضر، ${students.filter(s=>s.status==='absent').length} غائب)`;
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('تم الحفظ', msg);
    } catch (e) {
      const errMsg = 'حدث خطأ أثناء حفظ الحضور';
      if (Platform.OS === 'web') window.alert(errMsg);
      else Alert.alert('خطأ', errMsg);
    } finally { setSaving(false); }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'present': return 'checkmark-circle';
      case 'absent': return 'close-circle';
      case 'excused': return 'alert-circle';
      default: return 'help-circle';
    }
  };
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'present': return '#2e7d32';
      case 'absent': return '#c62828';
      case 'excused': return '#ef6c00';
      default: return '#666';
    }
  };
  const getStatusText = (status: string) => {
    switch (status) {
      case 'present': return 'حاضر';
      case 'absent': return 'غائب';
      case 'excused': return 'معذور';
      default: return '';
    }
  };

  if (loading) return <LoadingScreen />;

  // Course Selection
  if (!selectedCourse) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']} data-testid="attendance-course-select">
        <ScrollView style={styles.scrollView} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchCourses(); }} />}>
          <View style={styles.headerBanner}>
            <Ionicons name="clipboard" size={36} color="#1b5e20" />
            <Text style={styles.headerTitle}>اختر المقرر</Text>
            <Text style={styles.headerSub}>اختر المقرر لتسجيل حضور الطلاب</Text>
          </View>

          {pendingRecords.filter(r => !r.synced).length > 0 && (
            <View style={styles.pendingBanner}>
              <Ionicons name="time" size={18} color="#ef6c00" />
              <Text style={styles.pendingText}>{pendingRecords.filter(r => !r.synced).length} سجل بانتظار المزامنة</Text>
            </View>
          )}

          {courses.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="book-outline" size={48} color="#ccc" />
              <Text style={styles.emptyText}>لا توجد مقررات مسجلة لك</Text>
            </View>
          ) : courses.map(c => (
            <TouchableOpacity key={c.id} style={styles.courseCard} onPress={() => loadStudents(c)} data-testid={`select-course-${c.id}`}>
              <View style={styles.courseIcon}><Ionicons name="book" size={24} color="#1b5e20" /></View>
              <View style={styles.courseInfo}>
                <Text style={styles.courseName}>{c.name}</Text>
                {c.code && <Text style={styles.courseCode}>{c.code}</Text>}
              </View>
              <Ionicons name="chevron-back" size={22} color="#ccc" />
            </TouchableOpacity>
          ))}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Attendance Recording
  const presentCount = students.filter(s => s.status === 'present').length;
  const absentCount = students.filter(s => s.status === 'absent').length;
  const excusedCount = students.filter(s => s.status === 'excused').length;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']} data-testid="attendance-record">
      {/* Course header */}
      <View style={styles.courseHeader}>
        <TouchableOpacity onPress={() => { setSelectedCourse(null); setStudents([]); setSaved(false); }} style={styles.backBtn}>
          <Ionicons name="arrow-forward" size={22} color="#1b5e20" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.courseHeaderName}>{selectedCourse.name}</Text>
          <Text style={styles.courseHeaderDate}>{new Date().toLocaleDateString('ar-SA')}</Text>
        </View>
      </View>

      {/* Stats */}
      <View style={styles.attendanceStats}>
        <View style={styles.aStat}><Text style={[styles.aStatNum, { color: '#2e7d32' }]}>{presentCount}</Text><Text style={styles.aStatLabel}>حاضر</Text></View>
        <View style={styles.aStatDivider} />
        <View style={styles.aStat}><Text style={[styles.aStatNum, { color: '#c62828' }]}>{absentCount}</Text><Text style={styles.aStatLabel}>غائب</Text></View>
        {excusedCount > 0 && <><View style={styles.aStatDivider} />
        <View style={styles.aStat}><Text style={[styles.aStatNum, { color: '#ef6c00' }]}>{excusedCount}</Text><Text style={styles.aStatLabel}>بعذر معتمد</Text></View></>}
        <View style={styles.aStatDivider} />
        <View style={styles.aStat}><Text style={[styles.aStatNum, { color: '#333' }]}>{students.length}</Text><Text style={styles.aStatLabel}>الكل</Text></View>
      </View>

      {/* Quick Actions */}
      <View style={styles.quickActions}>
        <TouchableOpacity style={[styles.quickBtn, { backgroundColor: '#e8f5e9' }]} onPress={() => markAll('present')}>
          <Ionicons name="checkmark-done" size={18} color="#2e7d32" />
          <Text style={[styles.quickBtnText, { color: '#2e7d32' }]}>الكل حاضر</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.quickBtn, { backgroundColor: '#ffebee' }]} onPress={() => markAll('absent')}>
          <Ionicons name="close" size={18} color="#c62828" />
          <Text style={[styles.quickBtnText, { color: '#c62828' }]}>الكل غائب</Text>
        </TouchableOpacity>
      </View>

      {loadingStudents ? (
        <View style={styles.loadingCenter}><ActivityIndicator size="large" color="#1b5e20" /></View>
      ) : students.length === 0 ? (
        <View style={styles.emptyState}><Ionicons name="people-outline" size={48} color="#ccc" /><Text style={styles.emptyText}>لا يوجد طلاب مسجلين في هذا المقرر</Text></View>
      ) : (
        <ScrollView style={styles.studentsList}>
          {students.map((student, index) => (
            <TouchableOpacity key={student.id} style={styles.studentRow} onPress={() => toggleStatus(student.id)} data-testid={`student-${student.id}`}>
              <View style={styles.studentIndex}><Text style={styles.indexText}>{index + 1}</Text></View>
              <View style={styles.studentInfo}>
                <Text style={styles.studentName}>{student.full_name}</Text>
                <Text style={styles.studentIdText}>#{student.student_id}</Text>
              </View>
              <View style={[styles.statusBtn, { backgroundColor: getStatusColor(student.status) + '18' }]}>
                <Ionicons name={getStatusIcon(student.status)} size={22} color={getStatusColor(student.status)} />
                <Text style={[styles.statusBtnText, { color: getStatusColor(student.status) }]}>{getStatusText(student.status)}</Text>
              </View>
            </TouchableOpacity>
          ))}
          <View style={{ height: 100 }} />
        </ScrollView>
      )}

      {/* Save Button */}
      {students.length > 0 && (
        <View style={styles.saveContainer}>
          <TouchableOpacity
            style={[styles.saveBtn, saved && styles.saveBtnDone]}
            onPress={saveAttendance}
            disabled={saving || saved}
            data-testid="save-attendance-btn"
          >
            {saving ? <ActivityIndicator color="#fff" /> : (
              <>
                <Ionicons name={saved ? 'checkmark-circle' : 'save'} size={22} color="#fff" />
                <Text style={styles.saveBtnText}>{saved ? 'تم الحفظ' : 'حفظ الحضور'}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5' },
  scrollView: { flex: 1, padding: 16 },

  headerBanner: { alignItems: 'center', paddingVertical: 24, backgroundColor: '#e8f5e9', borderRadius: 20, marginBottom: 16 },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#1b5e20', marginTop: 8 },
  headerSub: { fontSize: 13, color: '#666', marginTop: 4 },

  pendingBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff3e0', padding: 10, borderRadius: 12, marginBottom: 16, gap: 8 },
  pendingText: { color: '#ef6c00', fontSize: 13, fontWeight: '600' },

  emptyState: { alignItems: 'center', padding: 40 },
  emptyText: { fontSize: 14, color: '#999', marginTop: 12 },

  courseCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 10, elevation: 1 },
  courseIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#e8f5e9', justifyContent: 'center', alignItems: 'center', marginLeft: 14 },
  courseInfo: { flex: 1 },
  courseName: { fontSize: 16, fontWeight: '600', color: '#1a1a2e' },
  courseCode: { fontSize: 12, color: '#888', marginTop: 2 },

  courseHeader: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 16, borderBottomWidth: 1, borderBottomColor: '#e8e8e8' },
  backBtn: { padding: 8, marginLeft: 8 },
  courseHeaderName: { fontSize: 17, fontWeight: 'bold', color: '#1a1a2e' },
  courseHeaderDate: { fontSize: 12, color: '#888', marginTop: 2 },

  attendanceStats: { flexDirection: 'row', backgroundColor: '#fff', padding: 14, borderBottomWidth: 1, borderBottomColor: '#e8e8e8' },
  aStat: { flex: 1, alignItems: 'center' },
  aStatNum: { fontSize: 20, fontWeight: 'bold' },
  aStatLabel: { fontSize: 11, color: '#888', marginTop: 2 },
  aStatDivider: { width: 1, backgroundColor: '#e8e8e8' },

  quickActions: { flexDirection: 'row', padding: 10, gap: 10 },
  quickBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 10, borderRadius: 10, gap: 6 },
  quickBtnText: { fontSize: 13, fontWeight: '600' },

  loadingCenter: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  studentsList: { flex: 1 },
  studentRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', marginHorizontal: 10, marginTop: 6, padding: 12, borderRadius: 12, elevation: 1 },
  studentIndex: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#f5f5f5', justifyContent: 'center', alignItems: 'center', marginLeft: 12 },
  indexText: { fontSize: 13, fontWeight: '600', color: '#666' },
  studentInfo: { flex: 1 },
  studentName: { fontSize: 15, fontWeight: '600', color: '#1a1a2e' },
  studentIdText: { fontSize: 12, color: '#999', marginTop: 2 },
  statusBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, gap: 4 },
  statusBtnText: { fontSize: 12, fontWeight: '600' },

  saveContainer: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, backgroundColor: '#f0f2f5' },
  saveBtn: { backgroundColor: '#1b5e20', borderRadius: 14, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, elevation: 4 },
  saveBtnDone: { backgroundColor: '#2e7d32' },
  saveBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
