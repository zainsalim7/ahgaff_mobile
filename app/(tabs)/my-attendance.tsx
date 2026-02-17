import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../src/store/authStore';
import { attendanceAPI, studentsAPI, settingsAPI, coursesAPI } from '../../src/services/api';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { StatusBadge } from '../../src/components/StatusBadge';
import { AttendanceRecord } from '../../src/types';
import { Ionicons } from '@expo/vector-icons';

interface CourseStats {
  course_id: string;
  course_name: string;
  course_code: string;
  total_lectures: number;
  present_count: number;
  absent_count: number;
  excused_count: number;
  attendance_rate: number;
  absence_rate: number;
  status: 'excellent' | 'good' | 'warning' | 'danger' | 'blocked';
  status_text: string;
}

// تحديد حالة الطالب بناءً على نسبة الغياب المسموح بها
const getStudentStatus = (
  attendanceRate: number, 
  maxAbsencePercent: number
): { status: CourseStats['status']; text: string; color: string } => {
  const absenceRate = 100 - attendanceRate;
  const minAttendance = 100 - maxAbsencePercent; // الحد الأدنى للحضور
  
  // إذا تجاوز نسبة الغياب المسموحة = محروم
  if (absenceRate > maxAbsencePercent) {
    return { status: 'blocked', text: 'محروم', color: '#9e9e9e' };
  }
  
  // نسبة الغياب من 80% إلى 100% من المسموح = خطر
  if (absenceRate >= maxAbsencePercent * 0.8) {
    return { status: 'danger', text: 'خطر الحرمان', color: '#f44336' };
  }
  
  // نسبة الغياب من 60% إلى 80% من المسموح = إنذار
  if (absenceRate >= maxAbsencePercent * 0.6) {
    return { status: 'warning', text: 'إنذار', color: '#ff9800' };
  }
  
  // نسبة الغياب من 30% إلى 60% من المسموح = جيد
  if (absenceRate >= maxAbsencePercent * 0.3) {
    return { status: 'good', text: 'جيد', color: '#2196f3' };
  }
  
  // نسبة الغياب أقل من 30% من المسموح = ممتاز
  return { status: 'excellent', text: 'ممتاز', color: '#4caf50' };
};

export default function MyAttendanceScreen() {
  const user = useAuthStore((state) => state.user);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [courseStats, setCourseStats] = useState<CourseStats[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<string | null>(null);
  const [courseRecords, setCourseRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [maxAbsencePercent, setMaxAbsencePercent] = useState(25); // القيمة الافتراضية

  // إحصائيات عامة
  const [overallStats, setOverallStats] = useState({
    totalLectures: 0,
    totalPresent: 0,
    totalAbsent: 0,
    overallRate: 0,
  });

  const fetchData = useCallback(async () => {
    try {
      // البحث عن الطالب باستخدام API الخاص
      let student;
      try {
        const studentRes = await studentsAPI.getMe();
        student = studentRes.data;
      } catch {
        // fallback للطريقة القديمة
        const studentsRes = await studentsAPI.getAll();
        student = studentsRes.data.find((s: any) => s.user_id === user?.id);
      }
      
      if (!student) {
        setLoading(false);
        return;
      }

      setStudentId(student.id);

      // الحصول على نسبة الغياب المسموحة من الإعدادات
      let currentMaxAbsence = maxAbsencePercent;
      try {
        const settingsRes = await settingsAPI.get();
        if (settingsRes.data?.max_absence_percent) {
          currentMaxAbsence = settingsRes.data.max_absence_percent;
          setMaxAbsencePercent(currentMaxAbsence);
        }
      } catch (e) {
        // استخدام القيمة الافتراضية
      }

      // جلب كل المقررات للطالب
      const coursesRes = await coursesAPI.getAll();
      const studentCourses = coursesRes.data.filter((c: any) => 
        c.department_id === student.department_id &&
        c.level === student.level &&
        (!c.section || c.section === student.section)
      );

      // جلب سجلات الحضور للطالب
      const recordsRes = await attendanceAPI.getStudentAttendance(student.id);
      const allRecords: AttendanceRecord[] = recordsRes.data;

      // تجميع البيانات حسب المادة
      const recordsByCourse = new Map<string, AttendanceRecord[]>();
      allRecords.forEach(record => {
        const key = record.course_id || record.course_name;
        if (!recordsByCourse.has(key)) {
          recordsByCourse.set(key, []);
        }
        recordsByCourse.get(key)!.push(record);
      });

      // حساب الإحصائيات لكل مادة (بما في ذلك المقررات بدون سجلات)
      const stats: CourseStats[] = [];
      let totalLectures = 0;
      let totalPresent = 0;
      let totalAbsent = 0;

      studentCourses.forEach((course: any) => {
        const records = recordsByCourse.get(course.id) || [];
        const present = records.filter(r => r.status === 'present').length;
        const absent = records.filter(r => r.status === 'absent').length;
        const excused = records.filter(r => r.status === 'excused').length;
        const total = records.length;
        
        // الغياب بعذر يُحتسب كحضور
        const effectivePresent = present + excused;
        const rate = total > 0 ? Math.round((effectivePresent / total) * 100) : 100;
        const absenceRate = total > 0 ? Math.round((absent / total) * 100) : 0;
        
        // تحديد الحالة فقط إذا كان هناك محاضرات
        const statusInfo = total > 0 
          ? getStudentStatus(rate, currentMaxAbsence)
          : { status: 'excellent' as const, text: 'جديد', color: '#9e9e9e' };

        stats.push({
          course_id: course.id,
          course_name: course.name,
          course_code: course.code,
          total_lectures: total,
          present_count: present,
          absent_count: absent,
          excused_count: excused,
          attendance_rate: rate,
          absence_rate: absenceRate,
          status: statusInfo.status,
          status_text: total > 0 ? statusInfo.text : 'جديد',
        });

        totalLectures += total;
        totalPresent += effectivePresent;
        totalAbsent += absent;
      });

      // ترتيب: المقررات التي لها محاضرات أولاً، ثم حسب نسبة الحضور
      stats.sort((a, b) => {
        if (a.total_lectures === 0 && b.total_lectures > 0) return 1;
        if (a.total_lectures > 0 && b.total_lectures === 0) return -1;
        return a.attendance_rate - b.attendance_rate;
      });

      setCourseStats(stats);
      setOverallStats({
        totalLectures,
        totalPresent,
        totalAbsent,
        overallRate: totalLectures > 0 ? Math.round((totalPresent / totalLectures) * 100) : 100,
      });

    } catch (error) {
      console.error('Error fetching attendance:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // جلب سجلات مادة معينة
  const fetchCourseRecords = async (courseId: string, courseName: string) => {
    if (selectedCourse === courseId) {
      setSelectedCourse(null);
      setCourseRecords([]);
      return;
    }

    setLoadingRecords(true);
    setSelectedCourse(courseId);

    try {
      const recordsRes = await attendanceAPI.getStudentAttendance(studentId!);
      const filtered = recordsRes.data.filter((r: AttendanceRecord) => 
        r.course_id === courseId || r.course_name === courseName
      );
      setCourseRecords(filtered.reverse()); // الأحدث أولاً
    } catch (error) {
      console.error('Error fetching course records:', error);
    } finally {
      setLoadingRecords(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('ar-SA', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  };

  const renderCourseCard = ({ item }: { item: CourseStats }) => {
    const statusInfo = getStudentStatus(item.attendance_rate, maxAbsencePercent);
    const isExpanded = selectedCourse === item.course_id;

    return (
      <View style={styles.courseCardContainer}>
        <TouchableOpacity
          style={[styles.courseCard, { borderLeftColor: statusInfo.color }]}
          onPress={() => fetchCourseRecords(item.course_id, item.course_name)}
          activeOpacity={0.7}
        >
          {/* Header */}
          <View style={styles.courseHeader}>
            <View style={styles.courseInfo}>
              <Text style={styles.courseName}>{item.course_name}</Text>
              {item.course_code && (
                <Text style={styles.courseCode}>{item.course_code}</Text>
              )}
            </View>
            <View style={[styles.statusBadge, { backgroundColor: statusInfo.color }]}>
              <Text style={styles.statusText}>{statusInfo.text}</Text>
            </View>
          </View>

          {/* Stats */}
          <View style={styles.courseStats}>
            <View style={styles.statBox}>
              <Ionicons name="calendar" size={16} color="#666" />
              <Text style={styles.statValue}>{item.total_lectures}</Text>
              <Text style={styles.statLabel}>محاضرة</Text>
            </View>
            <View style={styles.statBox}>
              <Ionicons name="checkmark-circle" size={16} color="#4caf50" />
              <Text style={[styles.statValue, { color: '#4caf50' }]}>{item.present_count}</Text>
              <Text style={styles.statLabel}>حضور</Text>
            </View>
            <View style={styles.statBox}>
              <Ionicons name="close-circle" size={16} color="#f44336" />
              <Text style={[styles.statValue, { color: '#f44336' }]}>{item.absent_count}</Text>
              <Text style={styles.statLabel}>غياب</Text>
            </View>
            <View style={styles.statBox}>
              <Ionicons name="alert-circle" size={16} color="#ff9800" />
              <Text style={[styles.statValue, { color: '#ff9800' }]}>{item.excused_count}</Text>
              <Text style={styles.statLabel}>عذر</Text>
            </View>
          </View>

          {/* Progress Bar */}
          <View style={styles.progressContainer}>
            <View style={styles.progressBar}>
              <View 
                style={[
                  styles.progressFill, 
                  { width: `${item.attendance_rate}%`, backgroundColor: statusInfo.color }
                ]} 
              />
            </View>
            <Text style={[styles.progressText, { color: statusInfo.color }]}>
              {item.attendance_rate}%
            </Text>
          </View>

          {/* Warning Message */}
          {item.status === 'warning' && (
            <View style={styles.warningBox}>
              <Ionicons name="warning" size={16} color="#ff9800" />
              <Text style={styles.warningText}>
                تحتاج حضور المزيد من المحاضرات لتجنب الحرمان
              </Text>
            </View>
          )}
          {item.status === 'danger' && (
            <View style={[styles.warningBox, { backgroundColor: '#ffebee' }]}>
              <Ionicons name="alert" size={16} color="#f44336" />
              <Text style={[styles.warningText, { color: '#c62828' }]}>
                أنت في خطر الحرمان! احضر جميع المحاضرات القادمة
              </Text>
            </View>
          )}
          {item.status === 'blocked' && (
            <View style={[styles.warningBox, { backgroundColor: '#eeeeee' }]}>
              <Ionicons name="ban" size={16} color="#616161" />
              <Text style={[styles.warningText, { color: '#424242' }]}>
                تم حرمانك من هذه المادة بسبب تجاوز نسبة الغياب
              </Text>
            </View>
          )}

          {/* Expand Icon */}
          <View style={styles.expandIcon}>
            <Ionicons 
              name={isExpanded ? "chevron-up" : "chevron-down"} 
              size={20} 
              color="#999" 
            />
          </View>
        </TouchableOpacity>

        {/* Expanded Records */}
        {isExpanded && (
          <View style={styles.recordsContainer}>
            {loadingRecords ? (
              <View style={styles.loadingRecords}>
                <Text style={styles.loadingText}>جاري التحميل...</Text>
              </View>
            ) : courseRecords.length === 0 ? (
              <View style={styles.noRecords}>
                <Text style={styles.noRecordsText}>لا توجد سجلات</Text>
              </View>
            ) : (
              <ScrollView style={styles.recordsList} nestedScrollEnabled>
                {courseRecords.map((record, index) => (
                  <View key={record.id || index} style={styles.recordItem}>
                    <Text style={styles.recordDate}>{formatDate(record.date)}</Text>
                    <StatusBadge status={record.status} />
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        )}
      </View>
    );
  };

  if (loading) {
    return <LoadingScreen />;
  }

  const overallStatus = getStudentStatus(overallStats.overallRate, maxAbsencePercent);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* Overall Stats Card */}
      <View style={styles.overallCard}>
        <View style={styles.overallHeader}>
          <View style={styles.overallIcon}>
            <Ionicons name="school" size={28} color="#fff" />
          </View>
          <View style={styles.overallInfo}>
            <Text style={styles.overallTitle}>نسبة الحضور الإجمالية</Text>
            <Text style={[styles.overallRate, { color: overallStatus.color }]}>
              {overallStats.overallRate}%
            </Text>
          </View>
          <View style={[styles.overallStatus, { backgroundColor: overallStatus.color }]}>
            <Text style={styles.overallStatusText}>{overallStatus.text}</Text>
          </View>
        </View>
        
        <View style={styles.overallStats}>
          <View style={styles.overallStatItem}>
            <Text style={styles.overallStatNumber}>{overallStats.totalLectures}</Text>
            <Text style={styles.overallStatLabel}>إجمالي المحاضرات</Text>
          </View>
          <View style={[styles.overallStatDivider]} />
          <View style={styles.overallStatItem}>
            <Text style={[styles.overallStatNumber, { color: '#4caf50' }]}>
              {overallStats.totalPresent}
            </Text>
            <Text style={styles.overallStatLabel}>حضور</Text>
          </View>
          <View style={[styles.overallStatDivider]} />
          <View style={styles.overallStatItem}>
            <Text style={[styles.overallStatNumber, { color: '#f44336' }]}>
              {overallStats.totalAbsent}
            </Text>
            <Text style={styles.overallStatLabel}>غياب</Text>
          </View>
        </View>
      </View>

      {/* Section Title */}
      <View style={styles.sectionHeader}>
        <Ionicons name="book" size={20} color="#1565c0" />
        <Text style={styles.sectionTitle}>تفاصيل المواد ({courseStats.length})</Text>
      </View>

      {/* Courses List */}
      {courseStats.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="calendar-outline" size={64} color="#ccc" />
          <Text style={styles.emptyText}>لا توجد سجلات حضور</Text>
          <Text style={styles.emptySubtext}>
            ستظهر هنا إحصائيات حضورك بعد تسجيل الحضور
          </Text>
        </View>
      ) : (
        <FlatList
          data={courseStats}
          renderItem={renderCourseCard}
          keyExtractor={(item) => item.course_id || item.course_name}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  overallCard: {
    backgroundColor: '#1565c0',
    margin: 16,
    marginBottom: 8,
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  overallHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  overallIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  overallInfo: {
    flex: 1,
  },
  overallTitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    marginBottom: 4,
  },
  overallRate: {
    fontSize: 32,
    fontWeight: 'bold',
  },
  overallStatus: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  overallStatusText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  overallStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    padding: 12,
  },
  overallStatItem: {
    alignItems: 'center',
    flex: 1,
  },
  overallStatDivider: {
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  overallStatNumber: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  overallStatLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  courseCardContainer: {
    marginBottom: 12,
  },
  courseCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  courseHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  courseInfo: {
    flex: 1,
  },
  courseName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 2,
  },
  courseCode: {
    fontSize: 12,
    color: '#999',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  courseStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  statBox: {
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  statLabel: {
    fontSize: 11,
    color: '#666',
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  progressBar: {
    flex: 1,
    height: 8,
    backgroundColor: '#e0e0e0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  progressText: {
    fontSize: 14,
    fontWeight: 'bold',
    minWidth: 45,
    textAlign: 'right',
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff3e0',
    padding: 10,
    borderRadius: 8,
    marginTop: 12,
    gap: 8,
  },
  warningText: {
    flex: 1,
    fontSize: 12,
    color: '#e65100',
  },
  expandIcon: {
    position: 'absolute',
    bottom: 8,
    left: '50%',
    marginLeft: -10,
  },
  recordsContainer: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginTop: 4,
    padding: 12,
    maxHeight: 200,
  },
  loadingRecords: {
    padding: 20,
    alignItems: 'center',
  },
  loadingText: {
    color: '#999',
  },
  noRecords: {
    padding: 20,
    alignItems: 'center',
  },
  noRecordsText: {
    color: '#999',
  },
  recordsList: {
    maxHeight: 180,
  },
  recordItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  recordDate: {
    fontSize: 14,
    color: '#666',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
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
});
