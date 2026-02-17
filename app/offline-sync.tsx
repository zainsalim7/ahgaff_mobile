import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useOfflineSyncStore, OfflineAttendanceRecord } from '../src/store/offlineSyncStore';

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  present: { label: 'حاضر', color: '#4caf50' },
  absent: { label: 'غائب', color: '#f44336' },
  late: { label: 'متأخر', color: '#ff9800' },
  excused: { label: 'معذور', color: '#2196f3' },
};

export default function OfflineSyncScreen() {
  const router = useRouter();
  const {
    isOnline,
    pendingRecords,
    cachedLectures,
    isSyncing,
    lastSyncTime,
    syncErrors,
    syncPendingRecords,
    clearAllData,
    loadFromStorage,
    getPendingRecordsCount,
  } = useOfflineSyncStore();

  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadFromStorage();
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadFromStorage();
    setRefreshing(false);
  }, [loadFromStorage]);

  const handleSync = async () => {
    if (!isOnline) {
      Alert.alert('غير متصل', 'لا يمكن المزامنة بدون اتصال بالإنترنت');
      return;
    }

    const result = await syncPendingRecords();
    
    if (result.failed > 0) {
      Alert.alert(
        'نتيجة المزامنة',
        `تم مزامنة ${result.success} سجل بنجاح\nفشل ${result.failed} سجل`,
        [{ text: 'حسناً' }]
      );
    } else if (result.success > 0) {
      Alert.alert('نجاح', `تم مزامنة ${result.success} سجل بنجاح`);
    }
  };

  const handleClearAll = () => {
    Alert.alert(
      'تأكيد المسح',
      'هل تريد حذف جميع البيانات المخزنة محلياً؟\nلن يمكن استعادتها.',
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'حذف الكل',
          style: 'destructive',
          onPress: async () => {
            await clearAllData();
            Alert.alert('تم', 'تم حذف جميع البيانات المحلية');
          },
        },
      ]
    );
  };

  const pendingCount = getPendingRecordsCount();
  const unsyncedRecords = pendingRecords.filter(r => !r.synced);
  const syncedRecords = pendingRecords.filter(r => r.synced);

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

  const renderRecord = ({ item }: { item: OfflineAttendanceRecord }) => {
    const statusInfo = STATUS_LABELS[item.status] || { label: item.status, color: '#666' };
    
    return (
      <View style={[styles.recordCard, item.synced && styles.recordCardSynced]}>
        <View style={styles.recordHeader}>
          <View style={styles.recordInfo}>
            <Text style={styles.studentName}>{item.student_name || item.student_id}</Text>
            <Text style={styles.lectureId}>محاضرة: {item.lecture_id.slice(-8)}</Text>
          </View>
          
          <View style={styles.recordStatus}>
            <View style={[styles.statusBadge, { backgroundColor: statusInfo.color }]}>
              <Text style={styles.statusText}>{statusInfo.label}</Text>
            </View>
            
            {item.synced ? (
              <View style={styles.syncedBadge}>
                <Ionicons name="checkmark-circle" size={16} color="#4caf50" />
                <Text style={styles.syncedText}>متزامن</Text>
              </View>
            ) : (
              <View style={styles.pendingBadge}>
                <Ionicons name="time" size={16} color="#ff9800" />
                <Text style={styles.pendingText}>معلق</Text>
              </View>
            )}
          </View>
        </View>
        
        <View style={styles.recordFooter}>
          <Text style={styles.recordTime}>{formatDate(item.timestamp)}</Text>
          {item.sync_error && (
            <Text style={styles.syncError} numberOfLines={1}>
              خطأ: {item.sync_error}
            </Text>
          )}
        </View>
      </View>
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'إدارة الأوفلاين',
          headerBackTitle: 'رجوع',
        }}
      />
      <SafeAreaView style={styles.container} edges={['bottom']}>
        {/* Connection Status */}
        <View style={[styles.connectionCard, isOnline ? styles.online : styles.offline]}>
          <Ionicons 
            name={isOnline ? 'wifi' : 'wifi-outline'} 
            size={24} 
            color={isOnline ? '#4caf50' : '#f44336'} 
          />
          <View style={styles.connectionInfo}>
            <Text style={styles.connectionStatus}>
              {isOnline ? 'متصل بالإنترنت' : 'غير متصل'}
            </Text>
            {lastSyncTime && (
              <Text style={styles.lastSync}>
                آخر مزامنة: {formatDate(lastSyncTime)}
              </Text>
            )}
          </View>
        </View>

        {/* Stats Cards */}
        <View style={styles.statsContainer}>
          <View style={[styles.statCard, { backgroundColor: '#fff3e0' }]}>
            <Ionicons name="time" size={28} color="#ff9800" />
            <Text style={styles.statNumber}>{pendingCount}</Text>
            <Text style={styles.statLabel}>معلق</Text>
          </View>
          
          <View style={[styles.statCard, { backgroundColor: '#e8f5e9' }]}>
            <Ionicons name="checkmark-circle" size={28} color="#4caf50" />
            <Text style={styles.statNumber}>{syncedRecords.length}</Text>
            <Text style={styles.statLabel}>متزامن</Text>
          </View>
          
          <View style={[styles.statCard, { backgroundColor: '#e3f2fd' }]}>
            <Ionicons name="folder" size={28} color="#1565c0" />
            <Text style={styles.statNumber}>{cachedLectures.length}</Text>
            <Text style={styles.statLabel}>محاضرات مخزنة</Text>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.syncBtn, (!isOnline || pendingCount === 0) && styles.disabledBtn]}
            onPress={handleSync}
            disabled={!isOnline || pendingCount === 0 || isSyncing}
          >
            {isSyncing ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="sync" size={20} color="#fff" />
                <Text style={styles.actionBtnText}>مزامنة الآن</Text>
              </>
            )}
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.actionBtn, styles.clearBtn]}
            onPress={handleClearAll}
          >
            <Ionicons name="trash" size={20} color="#fff" />
            <Text style={styles.actionBtnText}>مسح الكل</Text>
          </TouchableOpacity>
        </View>

        {/* Sync Errors */}
        {syncErrors.length > 0 && (
          <View style={styles.errorsCard}>
            <Text style={styles.errorsTitle}>أخطاء المزامنة الأخيرة</Text>
            {syncErrors.map((error, index) => (
              <Text key={index} style={styles.errorText}>• {error}</Text>
            ))}
          </View>
        )}

        {/* Records List */}
        <View style={styles.listHeader}>
          <Text style={styles.listTitle}>السجلات ({pendingRecords.length})</Text>
        </View>

        <FlatList
          data={pendingRecords}
          keyExtractor={(item) => item.local_id}
          renderItem={renderRecord}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="cloud-done" size={64} color="#ccc" />
              <Text style={styles.emptyText}>لا توجد سجلات محلية</Text>
              <Text style={styles.emptySubtext}>
                عند تسجيل الحضور بدون اتصال، ستظهر السجلات هنا
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
  connectionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 16,
    padding: 16,
    borderRadius: 12,
    gap: 12,
  },
  online: {
    backgroundColor: '#e8f5e9',
    borderColor: '#4caf50',
    borderWidth: 1,
  },
  offline: {
    backgroundColor: '#ffebee',
    borderColor: '#f44336',
    borderWidth: 1,
  },
  connectionInfo: {
    flex: 1,
  },
  connectionStatus: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  lastSync: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  statsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 12,
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 8,
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  actions: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderRadius: 10,
    gap: 8,
  },
  syncBtn: {
    backgroundColor: '#4caf50',
  },
  clearBtn: {
    backgroundColor: '#f44336',
  },
  disabledBtn: {
    backgroundColor: '#bdbdbd',
  },
  actionBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  errorsCard: {
    backgroundColor: '#ffebee',
    marginHorizontal: 16,
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  errorsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#c62828',
    marginBottom: 8,
  },
  errorText: {
    fontSize: 12,
    color: '#c62828',
    marginBottom: 4,
  },
  listHeader: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  listTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  recordCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderRightWidth: 4,
    borderRightColor: '#ff9800',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  recordCardSynced: {
    borderRightColor: '#4caf50',
    opacity: 0.8,
  },
  recordHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  recordInfo: {
    flex: 1,
  },
  studentName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  lectureId: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  recordStatus: {
    alignItems: 'flex-end',
    gap: 6,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  syncedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  syncedText: {
    fontSize: 11,
    color: '#4caf50',
  },
  pendingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  pendingText: {
    fontSize: 11,
    color: '#ff9800',
  },
  recordFooter: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  recordTime: {
    fontSize: 12,
    color: '#999',
  },
  syncError: {
    fontSize: 11,
    color: '#f44336',
    marginTop: 4,
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
