import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Modal,
  Share,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../src/store/authStore';
import { studentsAPI, departmentsAPI, settingsAPI, coursesAPI, attendanceAPI } from '../../src/services/api';
import api from '../../src/services/api';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import QRCode from 'react-native-qrcode-svg';

interface CourseStats {
  course_id: string;
  course_name: string;
  course_code: string;
  total_lectures: number;
  present_count: number;
  absent_count: number;
  excused_count: number;
  attendance_rate: number;
  status: 'excellent' | 'good' | 'warning' | 'danger';
}

export default function StudentHomeScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);

  const [studentInfo, setStudentInfo] = useState<any>(null);
  const [coursesStats, setCoursesStats] = useState<CourseStats[]>([]);
  const [departmentName, setDepartmentName] = useState('');
  const [collegeName, setCollegeName] = useState('');
  const [maxAbsencePercent, setMaxAbsencePercent] = useState(25);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showQRModal, setShowQRModal] = useState(false);
  const [notifCount, setNotifCount] = useState(0);

  const fetchData = useCallback(async () => {
    try {
      // Notifications count
      try {
        const notifRes = await api.get('/notifications/count');
        setNotifCount(notifRes.data?.count || 0);
      } catch (e) {}

      // Student data
      const studentRes = await studentsAPI.getMe();
      setStudentInfo(studentRes.data);

      // Department name
      if (studentRes.data?.department_id) {
        try {
          const deptsRes = await departmentsAPI.getAll();
          const dept = deptsRes.data.find((d: any) => d.id === studentRes.data.department_id);
          if (dept) setDepartmentName(dept.name);
        } catch (e) {}
      }

      // System settings
      try {
        const settingsRes = await settingsAPI.get();
        const maxAbsence = settingsRes.data?.max_absence_percent || 25;
        setMaxAbsencePercent(maxAbsence);
        if (settingsRes.data?.college_name) setCollegeName(settingsRes.data.college_name);
      } catch (e) {}

      // Course stats — 📐 من محرك اللائحة في الخادم (المنفَّذ فقط، بالساعات، حدّان)
      if (studentRes.data?.id) {
        const profRes = await api.get('/students/me/absence-profile');
        if (profRes.data?.limits?.total_limit) setMaxAbsencePercent(profRes.data.limits.total_limit);
        const results: CourseStats[] = (profRes.data?.courses || []).map((c: any) => ({
          course_id: c.course_id,
          course_name: c.course_name,
          course_code: c.course_code,
          total_lectures: c.executed_count,
          present_count: c.present_hours,
          absent_count: c.unexcused_hours,
          excused_count: c.excused_hours,
          attendance_rate: c.attendance_rate,
          status: (c.status === 'candidate' || c.status === 'danger') ? 'danger' : c.status === 'warning' ? 'warning' : c.status === 'good' ? 'good' : 'excellent',
        } as CourseStats));
        setCoursesStats(results);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const shareQRCode = async () => {
    if (!studentInfo?.qr_code) return;
    try {
      await Share.share({
        message: `رمز الحضور: ${studentInfo.full_name}\nالرقم الأكاديمي: ${studentInfo.student_id}\nكود QR: ${studentInfo.qr_code}`,
      });
    } catch (error) {
      console.error('Error sharing:', error);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'excellent': return '#2e7d32';
      case 'good': return '#1565c0';
      case 'warning': return '#ef6c00';
      case 'danger': return '#c62828';
      default: return '#666';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'excellent': return 'ممتاز';
      case 'good': return 'جيد';
      case 'warning': return 'تحذير';
      case 'danger': return 'خطر';
      default: return '';
    }
  };

  if (loading) return <LoadingScreen />;

  const overallRate = coursesStats.length > 0
    ? Math.round(coursesStats.reduce((sum, c) => sum + c.attendance_rate, 0) / coursesStats.length)
    : 100;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']} data-testid="student-home">
      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Welcome Card */}
        <View style={styles.welcomeCard}>
          <View style={styles.welcomeRow}>
            <View style={styles.avatar}>
              <Ionicons name="school" size={28} color="#fff" />
            </View>
            <View style={styles.welcomeInfo}>
              <Text style={styles.greeting}>مرحباً</Text>
              <Text style={styles.userName} data-testid="student-name">{user?.full_name}</Text>
              {studentInfo && (
                <Text style={styles.studentId}>#{studentInfo.student_id}</Text>
              )}
            </View>
            {/* Notifications */}
            <TouchableOpacity
              style={styles.notifBtn}
              onPress={() => router.push('/notifications')}
              data-testid="notifications-btn"
            >
              <Ionicons name="notifications" size={24} color="#fff" />
              {notifCount > 0 && (
                <View style={styles.notifBadge}>
                  <Text style={styles.notifBadgeText}>{notifCount > 9 ? '9+' : notifCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>

          {/* Student Details */}
          {studentInfo && (
            <View style={styles.detailsRow}>
              <View style={styles.detailItem}>
                <Ionicons name="business-outline" size={16} color="rgba(255,255,255,0.8)" />
                <Text style={styles.detailText}>{departmentName || 'غير محدد'}</Text>
              </View>
              <View style={styles.detailItem}>
                <Ionicons name="layers-outline" size={16} color="rgba(255,255,255,0.8)" />
                <Text style={styles.detailText}>المستوى {studentInfo.level}</Text>
              </View>
              {studentInfo.section && (
                <View style={styles.detailItem}>
                  <Ionicons name="people-outline" size={16} color="rgba(255,255,255,0.8)" />
                  <Text style={styles.detailText}>{studentInfo.section}</Text>
                </View>
              )}
            </View>
          )}

          {collegeName ? (
            <View style={styles.collegeRow}>
              <Ionicons name="school-outline" size={14} color="rgba(255,255,255,0.6)" />
              <Text style={styles.collegeText}>{collegeName}</Text>
            </View>
          ) : null}
        </View>

        {/* Quick Stats Row */}
        <View style={styles.quickStatsRow}>
          {/* Overall Attendance */}
          <View style={styles.overallCard}>
            <Text style={styles.overallLabel}>نسبة الحضور</Text>
            <Text style={[styles.overallRate, { color: overallRate >= 75 ? '#2e7d32' : overallRate >= 60 ? '#ef6c00' : '#c62828' }]}>
              {overallRate}%
            </Text>
          </View>

          {/* QR Code */}
          <TouchableOpacity
            style={styles.qrCard}
            onPress={() => setShowQRModal(true)}
            data-testid="qr-code-btn"
          >
            <Ionicons name="qr-code" size={32} color="#0d47a1" />
            <Text style={styles.qrLabel}>رمز الحضور</Text>
          </TouchableOpacity>

          {/* Courses Count */}
          <View style={styles.coursesCountCard}>
            <Text style={styles.coursesCountNum}>{coursesStats.length}</Text>
            <Text style={styles.coursesCountLabel}>مقرر</Text>
          </View>
        </View>

        {/* Attendance Summary */}
        {coursesStats.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="stats-chart" size={20} color="#0d47a1" />
              <Text style={styles.sectionTitle}>ملخص الحضور</Text>
            </View>

            <View style={styles.summaryRow}>
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryNum, { color: '#2e7d32' }]}>
                  {coursesStats.filter(c => c.status === 'excellent').length}
                </Text>
                <Text style={styles.summaryLabel}>ممتاز</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryNum, { color: '#1565c0' }]}>
                  {coursesStats.filter(c => c.status === 'good').length}
                </Text>
                <Text style={styles.summaryLabel}>جيد</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryNum, { color: '#ef6c00' }]}>
                  {coursesStats.filter(c => c.status === 'warning').length}
                </Text>
                <Text style={styles.summaryLabel}>تحذير</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryNum, { color: '#c62828' }]}>
                  {coursesStats.filter(c => c.status === 'danger').length}
                </Text>
                <Text style={styles.summaryLabel}>خطر</Text>
              </View>
            </View>
          </View>
        )}

        {/* Courses List */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="book" size={20} color="#0d47a1" />
            <Text style={styles.sectionTitle}>المقررات ({coursesStats.length})</Text>
          </View>

          {coursesStats.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="book-outline" size={48} color="#ccc" />
              <Text style={styles.emptyText}>لا توجد مقررات مسجلة</Text>
            </View>
          ) : (
            coursesStats.map((course) => (
              <View
                key={course.course_id}
                style={[styles.courseCard, { borderRightColor: getStatusColor(course.status) }]}
                data-testid={`course-card-${course.course_id}`}
              >
                <View style={styles.courseHeader}>
                  <View style={styles.courseInfo}>
                    <Text style={styles.courseName}>{course.course_name}</Text>
                    {course.course_code && (
                      <Text style={styles.courseCode}>{course.course_code}</Text>
                    )}
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: getStatusColor(course.status) }]}>
                    <Text style={styles.statusText}>{getStatusText(course.status)}</Text>
                  </View>
                </View>

                <View style={styles.courseStatsRow}>
                  <View style={styles.courseStat}>
                    <Text style={styles.courseStatNum}>{course.total_lectures}</Text>
                    <Text style={styles.courseStatLabel}>محاضرة</Text>
                  </View>
                  <View style={styles.courseStat}>
                    <Text style={[styles.courseStatNum, { color: '#2e7d32' }]}>{course.present_count}</Text>
                    <Text style={styles.courseStatLabel}>حضور</Text>
                  </View>
                  <View style={styles.courseStat}>
                    <Text style={[styles.courseStatNum, { color: '#c62828' }]}>{course.absent_count}</Text>
                    <Text style={styles.courseStatLabel}>غياب</Text>
                  </View>
                  <View style={styles.courseStat}>
                    <Text style={[styles.courseStatNum, { color: '#0d47a1' }]}>{Math.round(course.attendance_rate)}%</Text>
                    <Text style={styles.courseStatLabel}>الحضور</Text>
                  </View>
                </View>

                {/* Progress bar */}
                <View style={styles.progressBar}>
                  <View style={[styles.progressFill, { width: `${course.attendance_rate}%`, backgroundColor: getStatusColor(course.status) }]} />
                </View>
              </View>
            ))
          )}
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>

      {/* QR Modal */}
      <Modal visible={showQRModal} transparent animationType="fade" onRequestClose={() => setShowQRModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <TouchableOpacity style={styles.modalClose} onPress={() => setShowQRModal(false)}>
              <Ionicons name="close" size={24} color="#666" />
            </TouchableOpacity>

            <Text style={styles.modalTitle}>رمز الحضور</Text>
            <Text style={styles.modalName}>{studentInfo?.full_name}</Text>
            <Text style={styles.modalId}>#{studentInfo?.student_id}</Text>

            <View style={styles.qrContainer}>
              {studentInfo?.qr_code && (
                <QRCode value={studentInfo.qr_code} size={200} backgroundColor="white" color="#0d47a1" />
              )}
            </View>

            <TouchableOpacity style={styles.shareBtn} onPress={shareQRCode}>
              <Ionicons name="share-outline" size={20} color="#fff" />
              <Text style={styles.shareBtnText}>مشاركة</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5' },
  scrollView: { flex: 1 },

  // Welcome
  welcomeCard: {
    backgroundColor: '#0d47a1',
    margin: 16,
    borderRadius: 20,
    padding: 20,
    elevation: 4,
    shadowColor: '#0d47a1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  welcomeRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 14,
  },
  welcomeInfo: { flex: 1 },
  greeting: { fontSize: 13, color: 'rgba(255,255,255,0.7)' },
  userName: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginTop: 2 },
  studentId: { fontSize: 13, color: 'rgba(255,255,255,0.8)', fontWeight: '600', marginTop: 2 },
  notifBtn: { padding: 8, position: 'relative' },
  notifBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: '#f44336',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  notifBadgeText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  detailsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.15)',
    gap: 12,
  },
  detailItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  detailText: { fontSize: 12, color: 'rgba(255,255,255,0.8)' },
  collegeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    gap: 6,
  },
  collegeText: { fontSize: 11, color: 'rgba(255,255,255,0.5)' },

  // Quick Stats
  quickStatsRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 16,
    gap: 10,
  },
  overallCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
  },
  overallLabel: { fontSize: 11, color: '#666', marginBottom: 4 },
  overallRate: { fontSize: 28, fontWeight: 'bold' },
  qrCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
  },
  qrLabel: { fontSize: 11, color: '#666', marginTop: 4 },
  coursesCountCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
  },
  coursesCountNum: { fontSize: 28, fontWeight: 'bold', color: '#0d47a1' },
  coursesCountLabel: { fontSize: 11, color: '#666', marginTop: 4 },

  // Section
  section: {
    marginHorizontal: 16,
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a2e' },

  // Summary
  summaryRow: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    elevation: 1,
  },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryDivider: { width: 1, backgroundColor: '#e8e8e8' },
  summaryNum: { fontSize: 22, fontWeight: 'bold', color: '#333' },
  summaryLabel: { fontSize: 11, color: '#888', marginTop: 2 },

  // Course Card
  courseCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderRightWidth: 4,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
  },
  courseHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  courseInfo: { flex: 1, marginLeft: 8 },
  courseName: { fontSize: 15, fontWeight: '600', color: '#1a1a2e' },
  courseCode: { fontSize: 12, color: '#999', marginTop: 2 },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  statusText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  courseStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: '#f8f9fa',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
  },
  courseStat: { alignItems: 'center' },
  courseStatNum: { fontSize: 16, fontWeight: 'bold', color: '#333' },
  courseStatLabel: { fontSize: 10, color: '#888', marginTop: 2 },
  progressBar: {
    height: 6,
    backgroundColor: '#e8e8e8',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 3 },

  // Empty state
  emptyState: { alignItems: 'center', padding: 40 },
  emptyText: { fontSize: 15, color: '#999', marginTop: 12 },

  // QR Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 28,
    width: '90%',
    maxWidth: 360,
    alignItems: 'center',
  },
  modalClose: { position: 'absolute', top: 14, right: 14, padding: 6 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#1a1a2e', marginBottom: 4 },
  modalName: { fontSize: 16, color: '#666' },
  modalId: { fontSize: 14, color: '#0d47a1', fontWeight: '600', marginBottom: 20 },
  qrContainer: {
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#e8e8e8',
    marginBottom: 20,
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0d47a1',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 24,
    gap: 8,
  },
  shareBtnText: { fontSize: 16, color: '#fff', fontWeight: '600' },
});
