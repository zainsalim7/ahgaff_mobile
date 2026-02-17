import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { attendanceAPI } from '../src/services/api';
import { LoadingScreen } from '../src/components/LoadingScreen';

interface StudentStat {
  student_id: string;
  student_number: string;
  student_name: string;
  total_sessions: number;
  present_count: number;
  absent_count: number;
  late_count: number;
  attendance_rate: number;
}

export default function CourseStatsScreen() {
  const { courseId, courseName } = useLocalSearchParams();
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const response = await attendanceAPI.getCourseStats(courseId as string);
      setStats(response.data);
    } catch (error) {
      console.error('Error fetching stats:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [courseId]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchStats();
  };

  const getRateColor = (rate: number) => {
    if (rate >= 75) return '#4caf50';
    if (rate >= 50) return '#ff9800';
    return '#f44336';
  };

  const renderStudent = ({ item, index }: { item: StudentStat; index: number }) => (
    <View style={styles.studentCard}>
      <Text style={styles.studentIndex}>{index + 1}</Text>
      <View style={styles.studentInfo}>
        <Text style={styles.studentName}>{item.student_name}</Text>
        <Text style={styles.studentNumber}>{item.student_number}</Text>
        <View style={styles.statsRow}>
          <Text style={styles.statText}>حضور: {item.present_count}</Text>
          <Text style={[styles.statText, { color: '#f44336' }]}>
            غياب: {item.absent_count}
          </Text>
          <Text style={[styles.statText, { color: '#ff9800' }]}>
            تأخير: {item.late_count}
          </Text>
        </View>
      </View>
      <View style={[styles.rateBadge, { backgroundColor: getRateColor(item.attendance_rate) }]}>
        <Text style={styles.rateText}>{item.attendance_rate}%</Text>
      </View>
    </View>
  );

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* Course Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{courseName}</Text>
      </View>

      {/* Summary Stats */}
      {stats && (
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Ionicons name="calendar" size={24} color="#1565c0" />
              <Text style={styles.summaryValue}>{stats.total_sessions}</Text>
              <Text style={styles.summaryLabel}>جلسة</Text>
            </View>
            <View style={styles.summaryItem}>
              <Ionicons name="people" size={24} color="#4caf50" />
              <Text style={styles.summaryValue}>{stats.total_students}</Text>
              <Text style={styles.summaryLabel}>طالب</Text>
            </View>
          </View>
        </View>
      )}

      {/* Students List */}
      {stats?.student_stats?.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="stats-chart-outline" size={64} color="#ccc" />
          <Text style={styles.emptyText}>لا توجد إحصائيات</Text>
        </View>
      ) : (
        <FlatList
          data={stats?.student_stats || []}
          renderItem={renderStudent}
          keyExtractor={(item) => item.student_id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListHeaderComponent={
            <Text style={styles.listHeader}>إحصائيات الطلاب</Text>
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
  header: {
    backgroundColor: '#1565c0',
    padding: 16,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
  },
  summaryCard: {
    backgroundColor: '#fff',
    margin: 16,
    borderRadius: 12,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  summaryItem: {
    alignItems: 'center',
  },
  summaryValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 8,
  },
  summaryLabel: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  listHeader: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  studentCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  studentIndex: {
    width: 30,
    fontSize: 14,
    fontWeight: '600',
    color: '#999',
    textAlign: 'center',
  },
  studentInfo: {
    flex: 1,
    marginHorizontal: 12,
  },
  studentName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  studentNumber: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  statsRow: {
    flexDirection: 'row',
    marginTop: 6,
    gap: 12,
  },
  statText: {
    fontSize: 12,
    color: '#4caf50',
  },
  rateBadge: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  rateText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
    marginTop: 16,
  },
});
