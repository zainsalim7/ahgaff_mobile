import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Picker } from '@react-native-picker/picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { reportsAPI, departmentsAPI } from '../src/services/api';

export default function WarningsReport() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [warnings, setWarnings] = useState<any[]>([]);
  const [deprivations, setDeprivations] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [selectedDept, setSelectedDept] = useState('');
  const [warningThreshold, setWarningThreshold] = useState(25);
  const [deprivationThreshold, setDeprivationThreshold] = useState(40);
  const [summary, setSummary] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'warnings' | 'deprivations'>('warnings');
  const [exporting, setExporting] = useState(false);

  // دالة تصدير Excel
  const exportToExcel = async () => {
    try {
      setExporting(true);
      const params: any = {};
      if (selectedDept) params.department_id = selectedDept;

      const response = await reportsAPI.exportWarningsExcel(params);
      
      if (Platform.OS === 'web') {
        const blob = new Blob([response.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'warnings_report.xlsx';
        a.click();
      } else {
        const filename = `${FileSystem.documentDirectory}warnings_report.xlsx`;
        const reader = new FileReader();
        const blob = new Blob([response.data]);
        reader.onloadend = async () => {
          const base64 = (reader.result as string).split(',')[1];
          await FileSystem.writeAsStringAsync(filename, base64, { encoding: FileSystem.EncodingType.Base64 });
          await Sharing.shareAsync(filename);
        };
        reader.readAsDataURL(blob);
      }
      Alert.alert('نجاح', 'تم تصدير التقرير بنجاح');
    } catch (error) {
      console.error('Export error:', error);
      Alert.alert('خطأ', 'فشل في تصدير التقرير');
    } finally {
      setExporting(false);
    }
  };

  const fetchData = useCallback(async () => {
    try {
      const deptsRes = await departmentsAPI.getAll();
      setDepartments(deptsRes.data);
      
      const params: any = {
        warning_threshold: warningThreshold,
        deprivation_threshold: deprivationThreshold,
      };
      if (selectedDept) params.department_id = selectedDept;
      
      const reportRes = await reportsAPI.getWarningsReport(params);
      setWarnings(reportRes.data.warnings || []);
      setDeprivations(reportRes.data.deprivations || []);
      setSummary(reportRes.data.summary);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedDept, warningThreshold, deprivationThreshold]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#ff9800" />
        <Text style={styles.loadingText}>جاري تحميل التقرير...</Text>
      </View>
    );
  }

  const currentList = activeTab === 'warnings' ? warnings : deprivations;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-forward" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>الإنذارات والحرمان</Text>
        <TouchableOpacity 
          style={styles.exportBtn}
          onPress={exportToExcel}
          disabled={exporting || (warnings.length === 0 && deprivations.length === 0)}
        >
          {exporting ? (
            <ActivityIndicator size="small" color="#4caf50" />
          ) : (
            <Ionicons name="download-outline" size={24} color={(warnings.length > 0 || deprivations.length > 0) ? "#4caf50" : "#ccc"} />
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* الفلاتر */}
        <View style={styles.filtersCard}>
          <View style={styles.filterRow}>
            <Text style={styles.filterLabel}>القسم</Text>
            <View style={styles.pickerWrapper}>
              <Picker
                selectedValue={selectedDept}
                onValueChange={setSelectedDept}
                style={styles.picker}
              >
                <Picker.Item label="جميع الأقسام" value="" />
                {departments.map(d => (
                  <Picker.Item key={d.id} label={d.name} value={d.id} />
                ))}
              </Picker>
            </View>
          </View>

          <View style={styles.thresholdsRow}>
            <View style={styles.thresholdItem}>
              <Text style={styles.thresholdLabel}>حد الإنذار</Text>
              <View style={styles.thresholdValue}>
                <Text style={styles.thresholdText}>{warningThreshold}%</Text>
              </View>
            </View>
            <View style={styles.thresholdItem}>
              <Text style={styles.thresholdLabel}>حد الحرمان</Text>
              <View style={[styles.thresholdValue, styles.thresholdDanger]}>
                <Text style={[styles.thresholdText, styles.thresholdDangerText]}>{deprivationThreshold}%</Text>
              </View>
            </View>
          </View>
        </View>

        {/* ملخص */}
        {summary && (
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <View style={[styles.summaryItem, styles.warningBg]}>
                <Ionicons name="warning" size={24} color="#ff9800" />
                <Text style={styles.summaryValue}>{summary.total_warnings}</Text>
                <Text style={styles.summaryLabel}>إنذار</Text>
              </View>
              <View style={[styles.summaryItem, styles.dangerBg]}>
                <Ionicons name="close-circle" size={24} color="#f44336" />
                <Text style={styles.summaryValue}>{summary.total_deprivations}</Text>
                <Text style={styles.summaryLabel}>محروم</Text>
              </View>
            </View>
          </View>
        )}

        {/* التبويبات */}
        <View style={styles.tabsContainer}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'warnings' && styles.tabActive]}
            onPress={() => setActiveTab('warnings')}
          >
            <Ionicons name="warning" size={20} color={activeTab === 'warnings' ? '#ff9800' : '#999'} />
            <Text style={[styles.tabText, activeTab === 'warnings' && styles.tabTextActive]}>
              الإنذارات ({warnings.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'deprivations' && styles.tabActiveDanger]}
            onPress={() => setActiveTab('deprivations')}
          >
            <Ionicons name="close-circle" size={20} color={activeTab === 'deprivations' ? '#f44336' : '#999'} />
            <Text style={[styles.tabText, activeTab === 'deprivations' && styles.tabTextActiveDanger]}>
              المحرومين ({deprivations.length})
            </Text>
          </TouchableOpacity>
        </View>

        {/* القائمة */}
        {currentList.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="checkmark-circle" size={48} color="#4caf50" />
            <Text style={styles.emptyText}>
              {activeTab === 'warnings' ? 'لا يوجد إنذارات' : 'لا يوجد محرومين'}
            </Text>
          </View>
        ) : (
          currentList.map((item, index) => (
            <View key={index} style={[
              styles.studentCard,
              activeTab === 'deprivations' && styles.studentCardDanger
            ]}>
              <View style={styles.studentHeader}>
                <View style={styles.studentInfo}>
                  <Text style={styles.studentName}>{item.student_name}</Text>
                  <Text style={styles.studentId}>{item.student_id}</Text>
                </View>
                <View style={[
                  styles.statusBadge,
                  item.status === 'محروم' ? styles.statusDanger : styles.statusWarning
                ]}>
                  <Text style={styles.statusText}>{item.status}</Text>
                </View>
              </View>

              <View style={styles.courseInfo}>
                <Ionicons name="book-outline" size={16} color="#666" />
                <Text style={styles.courseName}>{item.course_name}</Text>
                <Text style={styles.courseCode}>({item.course_code})</Text>
              </View>

              <View style={styles.statsRow}>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{item.absent_count}</Text>
                  <Text style={styles.statLabel}>غياب</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{item.total_lectures}</Text>
                  <Text style={styles.statLabel}>محاضرة</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={[styles.statValue, styles.rateValue]}>{item.absence_rate}%</Text>
                  <Text style={styles.statLabel}>نسبة الغياب</Text>
                </View>
                {item.remaining_allowed !== undefined && (
                  <View style={styles.statItem}>
                    <Text style={[styles.statValue, item.remaining_allowed > 0 ? styles.remainingOk : styles.remainingDanger]}>
                      {item.remaining_allowed}
                    </Text>
                    <Text style={styles.statLabel}>متبقي</Text>
                  </View>
                )}
              </View>
            </View>
          ))
        )}
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
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  scrollView: {
    flex: 1,
    padding: 16,
  },
  filtersCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  filterRow: {
    marginBottom: 12,
  },
  filterLabel: {
    fontSize: 13,
    color: '#666',
    marginBottom: 4,
  },
  pickerWrapper: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    overflow: 'hidden',
  },
  picker: {
    height: 45,
  },
  thresholdsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 8,
  },
  thresholdItem: {
    alignItems: 'center',
  },
  thresholdLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  thresholdValue: {
    backgroundColor: '#fff3e0',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  thresholdDanger: {
    backgroundColor: '#ffebee',
  },
  thresholdText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ff9800',
  },
  thresholdDangerText: {
    color: '#f44336',
  },
  summaryCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  summaryItem: {
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    flex: 1,
    marginHorizontal: 8,
  },
  warningBg: {
    backgroundColor: '#fff3e0',
  },
  dangerBg: {
    backgroundColor: '#ffebee',
  },
  summaryValue: {
    fontSize: 28,
    fontWeight: '700',
    color: '#333',
    marginTop: 8,
  },
  summaryLabel: {
    fontSize: 14,
    color: '#666',
  },
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    gap: 6,
  },
  tabActive: {
    backgroundColor: '#fff3e0',
  },
  tabActiveDanger: {
    backgroundColor: '#ffebee',
  },
  tabText: {
    fontSize: 14,
    color: '#999',
  },
  tabTextActive: {
    color: '#ff9800',
    fontWeight: '600',
  },
  tabTextActiveDanger: {
    color: '#f44336',
    fontWeight: '600',
  },
  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    marginTop: 10,
    fontSize: 16,
    color: '#4caf50',
  },
  studentCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderRightWidth: 4,
    borderRightColor: '#ff9800',
  },
  studentCardDanger: {
    borderRightColor: '#f44336',
  },
  studentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  studentInfo: {
    flex: 1,
  },
  studentName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  studentId: {
    fontSize: 12,
    color: '#666',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusWarning: {
    backgroundColor: '#fff3e0',
  },
  statusDanger: {
    backgroundColor: '#ffebee',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
  },
  courseInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
    backgroundColor: '#f5f5f5',
    padding: 8,
    borderRadius: 8,
  },
  courseName: {
    fontSize: 13,
    color: '#333',
    flex: 1,
  },
  courseCode: {
    fontSize: 11,
    color: '#999',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
  },
  statLabel: {
    fontSize: 11,
    color: '#666',
  },
  rateValue: {
    color: '#f44336',
  },
  remainingOk: {
    color: '#4caf50',
  },
  remainingDanger: {
    color: '#f44336',
  },
  exportBtn: {
    padding: 4,
  },
});
