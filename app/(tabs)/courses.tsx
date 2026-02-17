import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { coursesAPI, departmentsAPI, lecturesAPI } from '../../src/services/api';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { Course, Department } from '../../src/types';
import { useAuth, PERMISSIONS } from '../../src/contexts/AuthContext';

interface TodayLecture {
  id: string;
  course_id: string;
  course_name: string;
  course_code: string;
  date: string;
  start_time: string;
  end_time: string;
  room: string;
  status: string;
  attendance_count: number;
  total_enrolled: number;
}

export default function CoursesScreen() {
  const router = useRouter();
  const { user, hasPermission } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [todayLectures, setTodayLectures] = useState<TodayLecture[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      // جلب محاضرات اليوم
      try {
        const todayRes = await lecturesAPI.getToday();
        setTodayLectures(todayRes.data || []);
      } catch (e) {
        console.log('No today lectures API or error:', e);
      }

      const [coursesRes, deptsRes] = await Promise.all([
        coursesAPI.getAll(),
        departmentsAPI.getAll(),
      ]);
      setCourses(coursesRes.data);
      setDepartments(deptsRes.data);
    } catch (error) {
      console.error('Error fetching courses:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const getDepartmentName = (deptId: string) => {
    const dept = departments.find(d => d.id === deptId);
    return dept?.name || 'غير محدد';
  };

  const formatTime = (time: string) => {
    if (!time) return '';
    return time;
  };

  const getLectureStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return '#4caf50';
      case 'cancelled': return '#f44336';
      default: return '#ff9800';
    }
  };

  const getLectureStatusText = (status: string) => {
    switch (status) {
      case 'completed': return 'منعقدة';
      case 'cancelled': return 'ملغاة';
      default: return 'مجدولة';
    }
  };

  const renderTodayLecture = ({ item }: { item: TodayLecture }) => (
    <TouchableOpacity
      style={styles.todayLectureCard}
      onPress={() => router.push({
        pathname: '/take-attendance',
        params: { lectureId: item.id, courseId: item.course_id }
      })}
    >
      <View style={styles.lectureTimeBox}>
        <Text style={styles.lectureTime}>{formatTime(item.start_time)}</Text>
        <Text style={styles.lectureTimeSeparator}>-</Text>
        <Text style={styles.lectureTime}>{formatTime(item.end_time)}</Text>
      </View>
      
      <View style={styles.lectureDetails}>
        <Text style={styles.lectureCourseName} numberOfLines={1}>{item.course_name}</Text>
        <Text style={styles.lectureCourseCode}>{item.course_code}</Text>
        {item.room && (
          <View style={styles.lectureRoom}>
            <Ionicons name="location-outline" size={12} color="#666" />
            <Text style={styles.lectureRoomText}>{item.room}</Text>
          </View>
        )}
      </View>
      
      <View style={styles.lectureStatus}>
        <View style={[styles.statusBadge, { backgroundColor: getLectureStatusColor(item.status) + '20' }]}>
          <Text style={[styles.statusText, { color: getLectureStatusColor(item.status) }]}>
            {getLectureStatusText(item.status)}
          </Text>
        </View>
        <View style={styles.attendanceInfo}>
          <Ionicons name="people" size={14} color="#666" />
          <Text style={styles.attendanceText}>
            {item.attendance_count}/{item.total_enrolled}
          </Text>
        </View>
      </View>
      
      <Ionicons name="chevron-back" size={20} color="#ccc" />
    </TouchableOpacity>
  );

  const renderCourse = ({ item }: { item: Course }) => {
    // التحقق من الصلاحيات - ندعم كلا الاسمين للتوافق مع الأدوار المختلفة
    const canRecordAttendance = hasPermission(PERMISSIONS.RECORD_ATTENDANCE) || hasPermission(PERMISSIONS.TAKE_ATTENDANCE);
    const canViewReports = hasPermission(PERMISSIONS.VIEW_REPORTS) || hasPermission(PERMISSIONS.VIEW_STATISTICS);
    const canViewAttendance = hasPermission(PERMISSIONS.VIEW_ATTENDANCE);
    
    return (
      <TouchableOpacity
        style={styles.courseCard}
        onPress={() => router.push({
          pathname: '/course-lectures',
          params: { courseId: item.id, courseName: item.name }
        })}
      >
        <View style={styles.courseIcon}>
          <Ionicons name="book" size={28} color="#1565c0" />
        </View>
        <View style={styles.courseInfo}>
          <Text style={styles.courseName}>{item.name}</Text>
          <Text style={styles.courseCode}>{item.code}</Text>
          <View style={styles.courseMeta}>
            <Text style={styles.metaText}>
              {getDepartmentName(item.department_id)} | المستوى {item.level} | شعبة {item.section}
            </Text>
          </View>
        </View>
        {/* عرض الأزرار فقط للمستخدمين المصرح لهم */}
        <View style={styles.actionButtons}>
          {/* زر الطلاب - لعرض قائمة الطلاب وإحصائيات الحضور */}
          {canViewAttendance && (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: '#fff3e0' }]}
              onPress={(e) => {
                e.stopPropagation();
                router.push({
                  pathname: '/course-students',
                  params: { courseId: item.id }
                });
              }}
            >
              <Ionicons name="people" size={20} color="#ff9800" />
            </TouchableOpacity>
          )}
          {/* زر الإحصائيات */}
          {canViewReports && (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: '#e8f5e9' }]}
              onPress={(e) => {
                e.stopPropagation();
                router.push({
                  pathname: '/course-stats',
                  params: { courseId: item.id, courseName: item.name }
                });
              }}
            >
              <Ionicons name="stats-chart" size={20} color="#4caf50" />
            </TouchableOpacity>
          )}
        </View>
        <Ionicons name="chevron-back" size={20} color="#ccc" />
      </TouchableOpacity>
    );
  };

  if (loading) {
    return <LoadingScreen />;
  }

  const todayDate = new Date().toLocaleDateString('ar-SA', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* قسم محاضرات اليوم */}
        {(user?.role === 'teacher' || user?.role === 'admin') && (
          <View style={styles.todaySection}>
            <View style={styles.todaySectionHeader}>
              <View style={styles.todayIconContainer}>
                <Ionicons name="today" size={24} color="#fff" />
              </View>
              <View>
                <Text style={styles.todaySectionTitle}>محاضرات اليوم</Text>
                <Text style={styles.todayDate}>{todayDate}</Text>
              </View>
            </View>
            
            {todayLectures.length === 0 ? (
              <View style={styles.noLecturesToday}>
                <Ionicons name="calendar-outline" size={40} color="#ccc" />
                <Text style={styles.noLecturesText}>لا توجد محاضرات مجدولة لليوم</Text>
              </View>
            ) : (
              <FlatList
                data={todayLectures}
                renderItem={renderTodayLecture}
                keyExtractor={(item) => item.id}
                scrollEnabled={false}
                ItemSeparatorComponent={() => <View style={styles.lectureSeparator} />}
              />
            )}
          </View>
        )}

        {/* قسم جميع المقررات */}
        <View style={styles.allCoursesSection}>
          <Text style={styles.sectionTitle}>جميع المقررات</Text>
          
          {courses.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="book-outline" size={64} color="#ccc" />
              <Text style={styles.emptyText}>لا توجد مقررات</Text>
            </View>
          ) : (
            <FlatList
              data={courses}
              renderItem={renderCourse}
              keyExtractor={(item) => item.id}
              scrollEnabled={false}
            />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  
  // Today Section Styles
  todaySection: {
    backgroundColor: '#fff',
    margin: 16,
    marginBottom: 8,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  todaySectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },
  todayIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#1565c0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  todaySectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  todayDate: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  noLecturesToday: {
    alignItems: 'center',
    padding: 24,
  },
  noLecturesText: {
    fontSize: 14,
    color: '#999',
    marginTop: 8,
  },
  todayLectureCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    gap: 12,
  },
  lectureTimeBox: {
    backgroundColor: '#1565c0',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
    minWidth: 70,
  },
  lectureTime: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  lectureTimeSeparator: {
    color: '#fff',
    fontSize: 10,
    opacity: 0.7,
  },
  lectureDetails: {
    flex: 1,
  },
  lectureCourseName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  lectureCourseCode: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  lectureRoom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  lectureRoomText: {
    fontSize: 11,
    color: '#666',
  },
  lectureStatus: {
    alignItems: 'flex-end',
    gap: 6,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  attendanceInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  attendanceText: {
    fontSize: 12,
    color: '#666',
  },
  lectureSeparator: {
    height: 8,
  },
  
  // All Courses Section
  allCoursesSection: {
    padding: 16,
    paddingTop: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  courseCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  courseIcon: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: '#e3f2fd',
    justifyContent: 'center',
    alignItems: 'center',
  },
  courseInfo: {
    flex: 1,
    marginHorizontal: 12,
  },
  courseName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  courseCode: {
    fontSize: 14,
    color: '#1565c0',
    marginTop: 2,
  },
  courseMeta: {
    marginTop: 4,
  },
  metaText: {
    fontSize: 12,
    color: '#666',
  },
  actionButtons: {
    gap: 8,
  },
  actionBtn: {
    width: 40,
    height: 40,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#fff',
    borderRadius: 12,
  },
  emptyText: {
    fontSize: 18,
    color: '#999',
    marginTop: 16,
  },
});
