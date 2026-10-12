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
import api, { attendanceAPI } from '../../src/services/api';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { StatusBadge } from '../../src/components/StatusBadge';
import { AttendanceRecord } from '../../src/types';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { formatGregorianDate, formatHijriDate, parseDate, WEEKDAYS_AR_SHORT } from '../../src/utils/dateUtils';

interface CourseStats {
  course_id: string;
  course_name: string;
  course_code: string;
  total_sessions: number;
  present_count: number;
  absent_count: number;
  excused_count: number;
  attendance_rate: number;
  absence_rate: number;
  status: 'excellent' | 'good' | 'warning' | 'danger' | 'blocked';
  status_text: string;
  executed_hours?: number; pct_unexcused?: number; pct_total?: number; limit_unexcused?: number; limit_total?: number;
  remaining_unexcused_hours?: number; remaining_total_hours?: number; early?: boolean;
}
const STATUS_UI: Record<CourseStats['status'], { text: string; color: string }> = {
  blocked: { text: 'مرشَّح للحرمان', color: '#9e9e9e' }, danger: { text: 'خطر الحرمان', color: '#f44336' },
  warning: { text: 'إنذار', color: '#ff9800' }, good: { text: 'جيد', color: '#2196f3' }, excellent: { text: 'ممتاز', color: '#4caf50' },
};

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
  const [limits, setLimits] = useState<any>(null);
  const [ruleText, setRuleText] = useState('');

  // إحصائيات عامة
  const [overallStats, setOverallStats] = useState({
    totalLectures: 0,
    totalPresent: 0,
    totalAbsent: 0,
    overallRate: 0,
  });

  const fetchData = useCallback(async () => {
    try {
      // 📐 المصدر الموحد: محرك اللائحة في الخادم (المنفَّذ فقط، بالساعات، حدّان)
      const res = await api.get('/students/me/absence-profile');
      const d = res.data;
      setStudentId(d.student_id || null);
      setLimits(d.limits);
      setRuleText(d.rule || '');
      setMaxAbsencePercent(d.limits?.total_limit || 25);
      const stats: CourseStats[] = (d.courses || []).map((c: any) => ({
        course_id: c.course_id, course_name: c.course_name, course_code: c.course_code || '',
        total_sessions: c.executed_count, present_count: c.present_hours, absent_count: c.unexcused_hours, excused_count: c.excused_hours,
        attendance_rate: c.attendance_rate, absence_rate: c.pct_total,
        status: c.status === 'candidate' ? 'blocked' : c.status, status_text: c.status_ar,
        executed_hours: c.executed_hours, pct_unexcused: c.pct_unexcused, pct_total: c.pct_total,
        limit_unexcused: c.limit_unexcused, limit_total: c.limit_total,
        remaining_unexcused_hours: c.remaining_unexcused_hours, remaining_total_hours: c.remaining_total_hours, early: c.early,
      }));
      setCourseStats(stats);
      const totalLectures = stats.reduce((a, s) => a + (s.executed_hours || 0), 0);
      const totalAbsent = stats.reduce((a, s) => a + s.absent_count + s.excused_count, 0);
      setOverallStats({
        totalLectures: Math.round(totalLectures * 10) / 10,
        totalPresent: Math.round((totalLectures - totalAbsent) * 10) / 10,
        totalAbsent: Math.round(totalAbsent * 10) / 10,
        overallRate: totalLectures > 0 ? Math.round(((totalLectures - totalAbsent) / totalLectures) * 100) : 100,
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
    return formatGregorianDate(date, { includeWeekday: true, includeYear: false });
  };

  const renderCourseCard = ({ item }: { item: CourseStats }) => {
    const statusInfo = { status: item.status, ...STATUS_UI[item.status] };
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
              <Text style={styles.statValue}>{item.total_sessions}</Text>
              <Text style={styles.statLabel}>منفَّذة ({item.executed_hours ?? 0} س)</Text>
            </View>
            <View style={styles.statBox}>
              <Ionicons name="checkmark-circle" size={16} color="#4caf50" />
              <Text style={[styles.statValue, { color: '#4caf50' }]}>{item.present_count}</Text>
              <Text style={styles.statLabel}>س حضور</Text>
            </View>
            <View style={styles.statBox}>
              <Ionicons name="close-circle" size={16} color="#f44336" />
              <Text style={[styles.statValue, { color: '#f44336' }]}>{item.absent_count}</Text>
              <Text style={styles.statLabel}>س بلا عذر ({item.pct_unexcused ?? 0}% / {item.limit_unexcused ?? 10}%)</Text>
            </View>
            <View style={styles.statBox}>
              <Ionicons name="alert-circle" size={16} color="#ff9800" />
              <Text style={[styles.statValue, { color: '#ff9800' }]}>{item.excused_count}</Text>
              <Text style={styles.statLabel}>س بعذر · الإجمالي {item.pct_total ?? 0}% / {item.limit_total ?? 25}%</Text>
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

          {item.early && item.total_sessions > 0 && (
            <Text style={{ fontSize: 11, color: '#64748b', textAlign: 'right', marginTop: 6 }} testID={`early-indicator-${item.course_id}`}>مؤشر مبكر — تنفَّذت {item.total_sessions} محاضرات فقط حتى الآن</Text>
          )}
          {item.status === 'blocked' && (
            <View style={[styles.warningBox, { backgroundColor: '#f3f4f6' }]}>
              <Ionicons name="ban" size={16} color="#374151" />
              <Text style={[styles.warningText, { color: '#374151' }]}>
                تجاوزت الحد المسموح ({item.pct_unexcused! > item.limit_unexcused! ? `بلا عذر ${item.pct_unexcused}% > ${item.limit_unexcused}%` : `الإجمالي ${item.pct_total}% > ${item.limit_total}%`}) — القرار النهائي لمجلس الكلية آخر الفصل
              </Text>
            </View>
          )}
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
  void limits;

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
        
        {!!ruleText && <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', textAlign: 'center', marginBottom: 8, lineHeight: 17 }} testID="absence-rule-text">{ruleText}</Text>}
        <TouchableOpacity onPress={() => router.push('/excuses')} style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.18)', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, marginBottom: 10 }} testID="my-excuses-btn">
          <Ionicons name="document-attach" size={15} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12.5 }}>أعذار الغياب — تقديم طلب / متابعة</Text>
        </TouchableOpacity>
        <View style={styles.overallStats}>
          <View style={styles.overallStatItem}>
            <Text style={styles.overallStatNumber}>{overallStats.totalLectures}</Text>
            <Text style={styles.overallStatLabel}>ساعات منفَّذة</Text>
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
