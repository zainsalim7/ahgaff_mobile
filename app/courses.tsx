import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../src/store/authStore';
import { coursesAPI, lecturesAPI } from '../src/services/api';

interface Course {
  id: string;
  name: string;
  code: string;
  department_name?: string;
  level: number;
  section?: string;
  teacher_id?: string;
  teacher_name?: string;
  lectures_count?: number;
}

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

export default function TeacherCoursesScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  
  const [courses, setCourses] = useState<Course[]>([]);
  const [todayLectures, setTodayLectures] = useState<TodayLecture[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      // جلب محاضرات اليوم
      const todayRes = await lecturesAPI.getToday();
      setTodayLectures(todayRes.data || []);
      
      // جلب كل المقررات
      const response = await coursesAPI.getAll();
      const allCourses = response.data;
      
      // البحث عن المقررات التي يدرسها هذا المعلم
      const teacherCourses = allCourses.filter((course: Course) => {
        if (user?.teacher_record_id && course.teacher_id === user.teacher_record_id) {
          return true;
        }
        if (user?.id && course.teacher_id === user.id) {
          return true;
        }
        if (user?.full_name && course.teacher_name === user.full_name) {
          return true;
        }
        return false;
      });
      
      // جلب عدد المحاضرات لكل مقرر
      const coursesWithLectures = await Promise.all(
        teacherCourses.map(async (course: Course) => {
          try {
            const lecturesRes = await lecturesAPI.getByCourse(course.id);
            return {
              ...course,
              lectures_count: lecturesRes.data.length,
            };
          } catch {
            return { ...course, lectures_count: 0 };
          }
        })
      );
      
      setCourses(coursesWithLectures);
    } catch (error) {
      console.error('Error fetching courses:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
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

  const renderCourse = ({ item }: { item: Course }) => (
    <TouchableOpacity
      style={styles.courseCard}
      onPress={() => router.push({
        pathname: '/course-lectures',
        params: { courseId: item.id, courseName: item.name }
      })}
    >
      <View style={styles.courseHeader}>
        <View style={[styles.courseIcon, { backgroundColor: '#e3f2fd' }]}>
          <Ionicons name="book" size={28} color="#1565c0" />
        </View>
        <View style={styles.courseInfo}>
          <Text style={styles.courseName}>{item.name}</Text>
          <Text style={styles.courseCode}>{item.code}</Text>
          {item.department_name && (
            <Text style={styles.courseDept}>{item.department_name}</Text>
          )}
        </View>
        <Ionicons name="chevron-back" size={24} color="#999" />
      </View>
      
      <View style={styles.courseStats}>
        <View style={styles.statItem}>
          <Ionicons name="layers-outline" size={16} color="#666" />
          <Text style={styles.statText}>المستوى {item.level}</Text>
        </View>
        {item.section && (
          <View style={styles.statItem}>
            <Ionicons name="people-outline" size={16} color="#666" />
            <Text style={styles.statText}>شعبة {item.section}</Text>
          </View>
        )}
        <View style={styles.statItem}>
          <Ionicons name="calendar-outline" size={16} color="#666" />
          <Text style={styles.statText}>{item.lectures_count || 0} محاضرة</Text>
        </View>
      </View>
      
      <View style={styles.courseActions}>
        <TouchableOpacity
          style={[styles.actionBtn, styles.lecturesBtn]}
          onPress={() => router.push({
            pathname: '/course-lectures',
            params: { courseId: item.id, courseName: item.name }
          })}
        >
          <Ionicons name="list" size={18} color="#1565c0" />
          <Text style={[styles.actionText, { color: '#1565c0' }]}>المحاضرات</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.actionBtn, styles.studentsBtn]}
          onPress={() => router.push({
            pathname: '/course-students',
            params: { courseId: item.id }
          })}
        >
          <Ionicons name="people" size={18} color="#ff9800" />
          <Text style={[styles.actionText, { color: '#ff9800' }]}>الطلاب</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1565c0" />
        <Text style={styles.loadingText}>جاري تحميل المقررات...</Text>
      </View>
    );
  }

  const todayDate = new Date().toLocaleDateString('ar-SA', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-forward" size={24} color="#1565c0" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>مقرراتي</Text>
        <View style={styles.headerBadge}>
          <Text style={styles.headerBadgeText}>{courses.length}</Text>
        </View>
      </View>

      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* قسم محاضرات اليوم */}
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

        {/* قسم جميع المقررات */}
        <View style={styles.allCoursesSection}>
          <Text style={styles.sectionTitle}>جميع المقررات</Text>
          
          {courses.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="book-outline" size={80} color="#ccc" />
              <Text style={styles.emptyTitle}>لا توجد مقررات</Text>
              <Text style={styles.emptyText}>
                لم يتم تعيين أي مقررات لك بعد.{'\n'}
                تواصل مع مدير النظام لربط المقررات.
              </Text>
            </View>
          ) : (
            <FlatList
              data={courses}
              renderItem={renderCourse}
              keyExtractor={(item) => item.id}
              scrollEnabled={false}
              contentContainerStyle={styles.coursesList}
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backBtn: {
    padding: 8,
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginHorizontal: 12,
  },
  headerBadge: {
    backgroundColor: '#1565c0',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  headerBadgeText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
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
  coursesList: {
    gap: 12,
  },
  courseCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  courseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  courseIcon: {
    width: 50,
    height: 50,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
  courseInfo: {
    flex: 1,
  },
  courseName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  courseCode: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  courseDept: {
    fontSize: 12,
    color: '#1565c0',
    marginTop: 2,
  },
  courseStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statText: {
    fontSize: 12,
    color: '#666',
  },
  courseActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 4,
  },
  attendanceBtn: {
    backgroundColor: '#e8f5e9',
  },
  lecturesBtn: {
    backgroundColor: '#e3f2fd',
  },
  studentsBtn: {
    backgroundColor: '#fff3e0',
  },
  actionText: {
    fontSize: 12,
    fontWeight: '500',
  },
  emptyContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#fff',
    borderRadius: 12,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#666',
    marginTop: 16,
  },
  emptyText: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 22,
  },
});
