import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { teachersAPI } from '../src/services/api';
import { LoadingScreen } from '../src/components/LoadingScreen';

interface Course {
  id: string;
  name: string;
  code: string;
  level: number;
  section: string;
  department_id: string;
  department_name: string;
  faculty_name: string;
  students_count: number;
  lectures_count: number;
  is_active: boolean;
}

interface TeacherCoursesData {
  teacher_id: string;
  teacher_name: string;
  total_courses: number;
  courses: Course[];
}

export default function TeacherCoursesScreen() {
  const { teacherId, teacherName } = useLocalSearchParams<{ teacherId: string; teacherName?: string }>();
  const router = useRouter();
  
  const [data, setData] = useState<TeacherCoursesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchCourses = useCallback(async () => {
    if (!teacherId) return;
    
    try {
      const response = await teachersAPI.getCourses(teacherId);
      setData(response.data);
    } catch (error) {
      console.error('Error fetching teacher courses:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [teacherId]);

  useEffect(() => {
    fetchCourses();
  }, [fetchCourses]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchCourses();
  };

  const renderCourse = ({ item }: { item: Course }) => (
    <TouchableOpacity
      style={styles.courseCard}
      onPress={() => router.push({
        pathname: '/course-lectures',
        params: { courseId: item.id, courseName: item.name }
      })}
    >
      <View style={styles.courseHeader}>
        <View style={styles.courseIcon}>
          <Ionicons name="book" size={24} color="#1565c0" />
        </View>
        <View style={styles.courseInfo}>
          <Text style={styles.courseName}>{item.name}</Text>
          <Text style={styles.courseCode}>{item.code}</Text>
        </View>
        <Ionicons name="chevron-back" size={20} color="#ccc" />
      </View>
      
      {/* معلومات الكلية والقسم */}
      <View style={styles.locationInfo}>
        {item.faculty_name && (
          <View style={styles.locationItem}>
            <Ionicons name="business" size={14} color="#666" />
            <Text style={styles.locationText}>{item.faculty_name}</Text>
          </View>
        )}
        {item.department_name && (
          <View style={styles.locationItem}>
            <Ionicons name="library" size={14} color="#666" />
            <Text style={styles.locationText}>{item.department_name}</Text>
          </View>
        )}
      </View>
      
      {/* إحصائيات المقرر */}
      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Ionicons name="school" size={16} color="#4caf50" />
          <Text style={styles.statText}>{item.students_count} طالب</Text>
        </View>
        <View style={styles.statItem}>
          <Ionicons name="calendar" size={16} color="#ff9800" />
          <Text style={styles.statText}>{item.lectures_count} محاضرة</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.levelText}>المستوى {item.level}</Text>
          {item.section && <Text style={styles.sectionText}>شعبة {item.section}</Text>}
        </View>
      </View>
    </TouchableOpacity>
  );

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: `مقررات ${teacherName || data?.teacher_name || 'المعلم'}`,
          headerBackTitle: 'رجوع',
        }}
      />
      <SafeAreaView style={styles.container} edges={['bottom']}>
        {/* ملخص */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryIcon}>
            <Ionicons name="person" size={32} color="#1565c0" />
          </View>
          <View style={styles.summaryInfo}>
            <Text style={styles.summaryName}>{data?.teacher_name}</Text>
            <Text style={styles.summaryCount}>
              يدرّس {data?.total_courses || 0} مقرر
            </Text>
          </View>
        </View>

        {/* قائمة المقررات */}
        <FlatList
          data={data?.courses || []}
          keyExtractor={(item) => item.id}
          renderItem={renderCourse}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="book-outline" size={64} color="#ccc" />
              <Text style={styles.emptyText}>لا توجد مقررات</Text>
              <Text style={styles.emptySubtext}>
                لم يتم تعيين أي مقرر لهذا المعلم بعد
              </Text>
            </View>
          }
          contentContainerStyle={styles.listContent}
        />
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  summaryCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    margin: 16,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  summaryIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#e3f2fd',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 16,
  },
  summaryInfo: {
    flex: 1,
  },
  summaryName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  summaryCount: {
    fontSize: 14,
    color: '#666',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  courseCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  courseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  courseIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#e3f2fd',
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
  locationInfo: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    gap: 16,
  },
  locationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  locationText: {
    fontSize: 13,
    color: '#666',
  },
  statsRow: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 16,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statText: {
    fontSize: 13,
    color: '#666',
  },
  levelText: {
    fontSize: 13,
    color: '#1565c0',
    fontWeight: '500',
  },
  sectionText: {
    fontSize: 13,
    color: '#666',
    marginRight: 8,
  },
  emptyContainer: {
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 13,
    color: '#bbb',
    marginTop: 8,
    textAlign: 'center',
  },
});
