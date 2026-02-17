import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useOfflineSyncStore } from '../store/offlineSyncStore';

interface OfflineIndicatorProps {
  showDetails?: boolean;
}

export const OfflineIndicator: React.FC<OfflineIndicatorProps> = ({ showDetails = false }) => {
  const { 
    isOnline, 
    pendingRecords, 
    isSyncing, 
    lastSyncTime,
    syncPendingRecords,
    getPendingRecordsCount,
  } = useOfflineSyncStore();
  
  const pendingCount = getPendingRecordsCount();
  const [pulseAnim] = useState(new Animated.Value(1));
  
  useEffect(() => {
    if (!isOnline || pendingCount > 0) {
      // تأثير نبض عندما يكون أوفلاين أو هناك سجلات معلقة
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.2, duration: 500, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
  }, [isOnline, pendingCount]);
  
  if (isOnline && pendingCount === 0 && !showDetails) {
    return null;
  }
  
  const formatTime = (isoString: string | null) => {
    if (!isoString) return 'لم تتم المزامنة';
    const date = new Date(isoString);
    return date.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
  };
  
  return (
    <View style={[styles.container, !isOnline && styles.offlineContainer]}>
      <View style={styles.statusRow}>
        <Animated.View style={{ transform: [{ scale: !isOnline ? pulseAnim : 1 }] }}>
          <Ionicons 
            name={isOnline ? "wifi" : "wifi-outline"} 
            size={20} 
            color={isOnline ? "#4caf50" : "#f44336"} 
          />
        </Animated.View>
        
        <Text style={[styles.statusText, !isOnline && styles.offlineText]}>
          {isOnline ? 'متصل' : 'غير متصل'}
        </Text>
        
        {pendingCount > 0 && (
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingText}>{pendingCount}</Text>
          </View>
        )}
        
        {pendingCount > 0 && isOnline && !isSyncing && (
          <TouchableOpacity 
            style={styles.syncBtn} 
            onPress={syncPendingRecords}
          >
            <Ionicons name="sync" size={18} color="#1565c0" />
          </TouchableOpacity>
        )}
        
        {isSyncing && (
          <ActivityIndicator size="small" color="#1565c0" style={styles.syncingIndicator} />
        )}
      </View>
      
      {showDetails && (
        <View style={styles.detailsRow}>
          <Text style={styles.detailText}>
            آخر مزامنة: {formatTime(lastSyncTime)}
          </Text>
          {pendingCount > 0 && (
            <Text style={styles.detailText}>
              سجلات معلقة: {pendingCount}
            </Text>
          )}
        </View>
      )}
      
      {!isOnline && (
        <Text style={styles.offlineMessage}>
          سيتم حفظ الحضور محلياً ومزامنته عند عودة الاتصال
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#e8f5e9',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginHorizontal: 16,
    marginVertical: 8,
  },
  offlineContainer: {
    backgroundColor: '#ffebee',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4caf50',
  },
  offlineText: {
    color: '#f44336',
  },
  pendingBadge: {
    backgroundColor: '#ff9800',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 4,
  },
  pendingText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  syncBtn: {
    marginLeft: 'auto',
    padding: 4,
  },
  syncingIndicator: {
    marginLeft: 'auto',
  },
  detailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  detailText: {
    fontSize: 12,
    color: '#666',
  },
  offlineMessage: {
    fontSize: 12,
    color: '#f44336',
    marginTop: 4,
    textAlign: 'center',
  },
});

export default OfflineIndicator;
