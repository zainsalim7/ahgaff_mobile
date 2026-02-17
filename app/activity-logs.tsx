import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Modal,
  TextInput,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { activityLogsAPI, usersAPI } from '../src/services/api';
import { LoadingScreen } from '../src/components/LoadingScreen';

interface ActivityLog {
  id: string;
  user_id: string;
  username: string;
  full_name?: string;
  action: string;
  details?: any;
  timestamp: string;
  ip_address?: string;
}

interface Stats {
  total: number;
  by_action: { action: string; count: number }[];
  by_user: { user_id: string; username: string; count: number }[];
}

const ACTION_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  login: { label: 'تسجيل دخول', icon: 'log-in', color: '#4caf50' },
  logout: { label: 'تسجيل خروج', icon: 'log-out', color: '#ff9800' },
  create: { label: 'إنشاء', icon: 'add-circle', color: '#2196f3' },
  update: { label: 'تحديث', icon: 'create', color: '#9c27b0' },
  delete: { label: 'حذف', icon: 'trash', color: '#f44336' },
  view: { label: 'عرض', icon: 'eye', color: '#607d8b' },
  export: { label: 'تصدير', icon: 'download', color: '#00bcd4' },
  import: { label: 'استيراد', icon: 'cloud-upload', color: '#795548' },
};

export default function ActivityLogsScreen() {
  const router = useRouter();
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [showStats, setShowStats] = useState(false);
  
  // Filters
  const [filterAction, setFilterAction] = useState<string>('');
  const [filterUser, setFilterUser] = useState<string>('');
  const [users, setUsers] = useState<{ id: string; username: string; full_name: string }[]>([]);

  const fetchLogs = useCallback(async (pageNum: number, refresh: boolean = false) => {
    try {
      if (refresh) {
        setPage(1);
        pageNum = 1;
      }

      const params: any = { page: pageNum, limit: 20 };
      if (filterAction) params.action = filterAction;
      if (filterUser) params.user_id = filterUser;

      const response = await activityLogsAPI.getAll(params);
      const newLogs = response.data.logs || [];
      
      if (refresh) {
        setLogs(newLogs);
      } else {
        setLogs(prev => [...prev, ...newLogs]);
      }
      
      setHasMore(newLogs.length === 20);
      setPage(pageNum);
    } catch (error) {
      console.error('Error fetching logs:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [filterAction, filterUser]);

  const fetchStats = useCallback(async () => {
    try {
      const response = await activityLogsAPI.getStats();
      setStats(response.data);
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const response = await usersAPI.getAll();
      setUsers(response.data || []);
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  }, []);

  useEffect(() => {
    fetchLogs(1, true);
    fetchStats();
    fetchUsers();
  }, [fetchLogs, fetchStats, fetchUsers]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchLogs(1, true);
    fetchStats();
  };

  const loadMore = () => {
    if (!loadingMore && hasMore) {
      setLoadingMore(true);
      fetchLogs(page + 1);
    }
  };

  const applyFilters = () => {
    setShowFilters(false);
    setLoading(true);
    fetchLogs(1, true);
  };

  const clearFilters = () => {
    setFilterAction('');
    setFilterUser('');
    setShowFilters(false);
    setLoading(true);
    fetchLogs(1, true);
  };

  const getActionInfo = (action: string) => {
    return ACTION_LABELS[action] || { label: action, icon: 'information-circle', color: '#666' };
  };

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('ar-SA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const renderLog = ({ item }: { item: ActivityLog }) => {
    const actionInfo = getActionInfo(item.action);
    
    return (
      <View style={styles.logCard}>
        <View style={[styles.actionIcon, { backgroundColor: actionInfo.color + '20' }]}>
          <Ionicons name={actionInfo.icon as any} size={24} color={actionInfo.color} />
        </View>
        
        <View style={styles.logContent}>
          <View style={styles.logHeader}>
            <Text style={styles.userName}>{item.full_name || item.username}</Text>
            <View style={[styles.actionBadge, { backgroundColor: actionInfo.color }]}>
              <Text style={styles.actionText}>{actionInfo.label}</Text>
            </View>
          </View>
          
          <Text style={styles.logUsername}>@{item.username}</Text>
          
          {item.details && (
            <Text style={styles.logDetails} numberOfLines={2}>
              {typeof item.details === 'object' 
                ? JSON.stringify(item.details)
                : String(item.details)}
            </Text>
          )}
          
          <Text style={styles.logTime}>{formatDate(item.timestamp)}</Text>
        </View>
      </View>
    );
  };

  const renderFooter = () => {
    if (!loadingMore) return null;
    return (
      <View style={styles.loadingMore}>
        <ActivityIndicator size="small" color="#1565c0" />
      </View>
    );
  };

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: 'سجلات النشاط',
          headerBackTitle: 'رجوع',
        }}
      />
      <SafeAreaView style={styles.container} edges={['bottom']}>
        {/* Header Actions */}
        <View style={styles.headerActions}>
          <TouchableOpacity 
            style={styles.headerBtn}
            onPress={() => setShowStats(true)}
          >
            <Ionicons name="stats-chart" size={20} color="#1565c0" />
            <Text style={styles.headerBtnText}>الإحصائيات</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.headerBtn, (filterAction || filterUser) && styles.headerBtnActive]}
            onPress={() => setShowFilters(true)}
          >
            <Ionicons name="filter" size={20} color={(filterAction || filterUser) ? '#fff' : '#1565c0'} />
            <Text style={[styles.headerBtnText, (filterAction || filterUser) && styles.headerBtnTextActive]}>
              تصفية
            </Text>
          </TouchableOpacity>
        </View>

        {/* Stats Summary */}
        {stats && (
          <View style={styles.statsSummary}>
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{stats.total}</Text>
              <Text style={styles.statLabel}>إجمالي السجلات</Text>
            </View>
          </View>
        )}

        {/* Logs List */}
        <FlatList
          data={logs}
          keyExtractor={(item) => item.id}
          renderItem={renderLog}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={renderFooter}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="document-text-outline" size={64} color="#ccc" />
              <Text style={styles.emptyText}>لا توجد سجلات</Text>
            </View>
          }
          contentContainerStyle={styles.listContent}
        />

        {/* Filters Modal */}
        <Modal
          visible={showFilters}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setShowFilters(false)}
        >
          <SafeAreaView style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setShowFilters(false)}>
                <Ionicons name="close" size={28} color="#333" />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>تصفية السجلات</Text>
              <TouchableOpacity onPress={clearFilters}>
                <Text style={styles.clearBtn}>مسح</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalContent}>
              {/* Filter by Action */}
              <View style={styles.filterSection}>
                <Text style={styles.filterLabel}>نوع النشاط</Text>
                <View style={styles.filterOptions}>
                  {Object.entries(ACTION_LABELS).map(([key, value]) => (
                    <TouchableOpacity
                      key={key}
                      style={[
                        styles.filterOption,
                        filterAction === key && { backgroundColor: value.color }
                      ]}
                      onPress={() => setFilterAction(filterAction === key ? '' : key)}
                    >
                      <Ionicons 
                        name={value.icon as any} 
                        size={18} 
                        color={filterAction === key ? '#fff' : value.color} 
                      />
                      <Text style={[
                        styles.filterOptionText,
                        filterAction === key && { color: '#fff' }
                      ]}>
                        {value.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Filter by User */}
              <View style={styles.filterSection}>
                <Text style={styles.filterLabel}>المستخدم</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.userFilters}>
                    {users.slice(0, 10).map((user) => (
                      <TouchableOpacity
                        key={user.id}
                        style={[
                          styles.userChip,
                          filterUser === user.id && styles.userChipActive
                        ]}
                        onPress={() => setFilterUser(filterUser === user.id ? '' : user.id)}
                      >
                        <Text style={[
                          styles.userChipText,
                          filterUser === user.id && styles.userChipTextActive
                        ]}>
                          {user.full_name || user.username}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.applyBtn} onPress={applyFilters}>
                <Text style={styles.applyBtnText}>تطبيق</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </Modal>

        {/* Stats Modal */}
        <Modal
          visible={showStats}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setShowStats(false)}
        >
          <SafeAreaView style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setShowStats(false)}>
                <Ionicons name="close" size={28} color="#333" />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>إحصائيات النشاط</Text>
              <View style={{ width: 28 }} />
            </View>

            <ScrollView style={styles.modalContent}>
              {stats && (
                <>
                  {/* By Action */}
                  <View style={styles.statsSection}>
                    <Text style={styles.statsSectionTitle}>حسب النشاط</Text>
                    {stats.by_action.map((item) => {
                      const actionInfo = getActionInfo(item.action);
                      return (
                        <View key={item.action} style={styles.statsRow}>
                          <View style={styles.statsRowLeft}>
                            <Ionicons name={actionInfo.icon as any} size={20} color={actionInfo.color} />
                            <Text style={styles.statsRowLabel}>{actionInfo.label}</Text>
                          </View>
                          <Text style={styles.statsRowValue}>{item.count}</Text>
                        </View>
                      );
                    })}
                  </View>

                  {/* By User */}
                  <View style={styles.statsSection}>
                    <Text style={styles.statsSectionTitle}>أكثر المستخدمين نشاطاً</Text>
                    {stats.by_user.map((item, index) => (
                      <View key={item.user_id} style={styles.statsRow}>
                        <View style={styles.statsRowLeft}>
                          <View style={[styles.rankBadge, index === 0 && styles.rankBadgeTop]}>
                            <Text style={styles.rankText}>{index + 1}</Text>
                          </View>
                          <Text style={styles.statsRowLabel}>{item.username}</Text>
                        </View>
                        <Text style={styles.statsRowValue}>{item.count}</Text>
                      </View>
                    ))}
                  </View>
                </>
              )}
            </ScrollView>
          </SafeAreaView>
        </Modal>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  headerActions: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
  },
  headerBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    backgroundColor: '#fff',
    borderRadius: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  headerBtnActive: {
    backgroundColor: '#1565c0',
    borderColor: '#1565c0',
  },
  headerBtnText: {
    fontSize: 14,
    color: '#1565c0',
    fontWeight: '600',
  },
  headerBtnTextActive: {
    color: '#fff',
  },
  statsSummary: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  statItem: {
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1565c0',
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  logCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  actionIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
  logContent: {
    flex: 1,
  },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  userName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  actionBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  actionText: {
    fontSize: 11,
    color: '#fff',
    fontWeight: '600',
  },
  logUsername: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  logDetails: {
    fontSize: 13,
    color: '#888',
    marginBottom: 4,
  },
  logTime: {
    fontSize: 11,
    color: '#999',
  },
  loadingMore: {
    padding: 16,
    alignItems: 'center',
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
  // Modal Styles
  modalContainer: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  clearBtn: {
    fontSize: 14,
    color: '#f44336',
    fontWeight: '600',
  },
  modalContent: {
    flex: 1,
    padding: 16,
  },
  modalFooter: {
    padding: 16,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  applyBtn: {
    backgroundColor: '#1565c0',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  applyBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  filterSection: {
    marginBottom: 24,
  },
  filterLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  filterOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    gap: 6,
  },
  filterOptionText: {
    fontSize: 13,
    color: '#333',
  },
  userFilters: {
    flexDirection: 'row',
    gap: 8,
  },
  userChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  userChipActive: {
    backgroundColor: '#1565c0',
    borderColor: '#1565c0',
  },
  userChipText: {
    fontSize: 13,
    color: '#333',
  },
  userChipTextActive: {
    color: '#fff',
  },
  // Stats Modal
  statsSection: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  statsSectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 16,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  statsRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  statsRowLabel: {
    fontSize: 14,
    color: '#333',
  },
  statsRowValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1565c0',
  },
  rankBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#e0e0e0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  rankBadgeTop: {
    backgroundColor: '#ffc107',
  },
  rankText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
});
