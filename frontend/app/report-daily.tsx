import { goBack } from '../src/utils/navigation';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
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
import { formatGregorianDate, WEEKDAYS_AR } from '../src/utils/dateUtils';
import { exportToPDF, prepareDailyReportData } from '../src/utils/pdfExport';

export default function DailyReport() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lectures, setLectures] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [selectedDept, setSelectedDept] = useState('');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [summary, setSummary] = useState<any>(null);
  const [exporting, setExporting] = useState(false);
  const [exportingPDF, setExportingPDF] = useState(false);

  // دالة تصدير PDF
  const handleExportPDF = async () => {
    try {
      setExportingPDF(true);
      const formattedDate = formatGregorianDate(new Date(selectedDate), { includeWeekday: true });
      const reportData = prepareDailyReportData(lectures, formattedDate, summary);
      await exportToPDF(reportData);
    } catch (error) {
      console.error('PDF Export error:', error);
    } finally {
      setExportingPDF(false);
    }
  };

  // دالة تصدير Excel
  const exportToExcel = async () => {
    try {
      setExporting(true);
      const params: any = { date: selectedDate };
      if (selectedDept) params.department_id = selectedDept;

      const response = await reportsAPI.exportDailyExcel(params);
      
      if (Platform.OS === 'web') {
        const blob = new Blob([response.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const xf = (response.headers as any)?.['x-filename'];
        a.download = xf ? decodeURIComponent(xf) : `daily_report_${selectedDate}.xlsx`;
        a.click();
      } else {
        const filename = `${FileSystem.documentDirectory}daily_report_${selectedDate}.xlsx`;
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

  // تحميل الأقسام فقط عند الفتح
  useEffect(() => {
    (async () => {
      try {
        const deptsRes = await departmentsAPI.getAll();
        setDepartments(deptsRes.data);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, []);

  // تنفيذ التقرير
  const runReport = useCallback(async () => {
    setExecuting(true);
    try {
      const params: any = { date: selectedDate };
      if (selectedDept) params.department_id = selectedDept;

      const reportRes = await reportsAPI.getDailyReport(params);
      setLectures(reportRes.data.lectures || []);
      setSummary(reportRes.data.summary);
      setHasRun(true);
    } catch (error) {
      console.error('Error running report:', error);
      if (Platform.OS === 'web') window.alert('فشل في تنفيذ التقرير');
      else Alert.alert('خطأ', 'فشل في تنفيذ التقرير');
    } finally {
      setExecuting(false);
      setRefreshing(false);
    }
  }, [selectedDept, selectedDate]);

  const onRefresh = () => {
    if (!hasRun) return;
    setRefreshing(true);
    runReport();
  };

  const changeDate = (days: number) => {
    const date = new Date(selectedDate);
    date.setDate(date.getDate() + days);
    setSelectedDate(date.toISOString().split('T')[0]);
  };

  const formatDateStr = (dateStr: string) => {
    const date = new Date(dateStr);
    const dayName = WEEKDAYS_AR[date.getDay()];
    return `${dayName}، ${formatGregorianDate(date, { includeYear: true })}`;
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4caf50" />
        <Text style={styles.loadingText}>جاري تحميل التقرير...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => goBack()} accessibilityLabel="رجوع">
          <Ionicons name="arrow-forward" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>التقرير اليومي</Text>
        <View style={styles.headerButtons}>
          {Platform.OS === 'web' && (
            <TouchableOpacity 
              style={styles.exportBtn}
              onPress={handleExportPDF}
              disabled={exportingPDF || lectures.length === 0}
              accessibilityLabel="تصدير PDF"
            >
              {exportingPDF ? (
                <ActivityIndicator size="small" color="#e53935" />
              ) : (
                <Ionicons name="document-text-outline" size={22} color={lectures.length > 0 ? "#e53935" : "#ccc"} />
              )}
            </TouchableOpacity>
          )}
          <TouchableOpacity 
            style={styles.exportBtn}
            onPress={exportToExcel}
            disabled={exporting || lectures.length === 0}
            accessibilityLabel="تصدير Excel"
          >
            {exporting ? (
              <ActivityIndicator size="small" color="#4caf50" />
            ) : (
              <Ionicons name="download-outline" size={24} color={lectures.length > 0 ? "#4caf50" : "#ccc"} />
            )}
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* التاريخ */}
        <View style={styles.dateCard}>
          <TouchableOpacity style={styles.dateBtn} onPress={() => changeDate(-1)}>
            <Ionicons name="chevron-forward" size={24} color="#1565c0" />
          </TouchableOpacity>
          <View style={styles.dateDisplay}>
            <Text style={styles.dateText}>{formatDateStr(selectedDate)}</Text>
            <TouchableOpacity 
              style={styles.todayBtn}
              onPress={() => setSelectedDate(new Date().toISOString().split('T')[0])}
            >
              <Text style={styles.todayBtnText}>اليوم</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.dateBtn} onPress={() => changeDate(1)}>
            <Ionicons name="chevron-back" size={24} color="#1565c0" />
          </TouchableOpacity>
        </View>

        {/* فلتر القسم */}
        <View style={styles.filterCard}>
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

          {/* زر التنفيذ */}
          <TouchableOpacity
            style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#1565c0', paddingVertical: 12, borderRadius: 10, marginTop: 12 }, executing && { opacity: 0.7 }]}
            onPress={runReport}
            disabled={executing}
            testID="run-report-btn"
          >
            {executing ? (
              <>
                <ActivityIndicator size="small" color="#fff" />
                <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>جاري التنفيذ...</Text>
              </>
            ) : (
              <>
                <Ionicons name="play" size={18} color="#fff" />
                <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>{hasRun ? 'إعادة التنفيذ' : 'تنفيذ التقرير'}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* قبل التنفيذ: رسالة إرشادية */}
        {!hasRun && !executing && (
          <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 32, alignItems: 'center', marginBottom: 12 }}>
            <Ionicons name="information-circle-outline" size={48} color="#90a4ae" />
            <Text style={{ marginTop: 10, fontSize: 15, fontWeight: '600', color: '#455a64', textAlign: 'center' }}>اختر التاريخ والقسم ثم اضغط "تنفيذ التقرير"</Text>
          </View>
        )}

        {/* ملخص اليوم */}
        {summary && (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>ملخص اليوم</Text>
            <View style={styles.summaryGrid}>
              <View style={styles.summaryItem}>
                <Ionicons name="calendar" size={24} color="#1565c0" />
                <Text style={styles.summaryValue}>{summary.total_lectures}</Text>
                <Text style={styles.summaryLabel}>محاضرة</Text>
              </View>
              <View style={styles.summaryItem}>
                <Ionicons name="checkmark-circle" size={24} color="#4caf50" />
                <Text style={styles.summaryValue}>{summary.total_present}</Text>
                <Text style={styles.summaryLabel}>حاضر</Text>
              </View>
              <View style={styles.summaryItem}>
                <Ionicons name="close-circle" size={24} color="#f44336" />
                <Text style={styles.summaryValue}>{summary.total_absent}</Text>
                <Text style={styles.summaryLabel}>غائب</Text>
              </View>
              <View style={styles.summaryItem}>
                <Ionicons name="stats-chart" size={24} color="#ff9800" />
                <Text style={styles.summaryValue}>{summary.overall_attendance_rate}%</Text>
                <Text style={styles.summaryLabel}>نسبة الحضور</Text>
              </View>
            </View>
          </View>
        )}

        {/* قائمة المحاضرات */}
        <Text style={styles.sectionTitle}>المحاضرات ({lectures.length})</Text>
        
        {lectures.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="calendar-outline" size={48} color="#ccc" />
            <Text style={styles.emptyText}>لا توجد محاضرات في هذا اليوم</Text>
          </View>
        ) : (
          lectures.map((lecture, index) => (
            <View key={index} style={styles.lectureCard}>
              <View style={styles.lectureHeader}>
                <View style={styles.lectureInfo}>
                  <Text style={styles.lectureName}>{lecture.course_name}</Text>
                  <Text style={styles.lectureCode}>{lecture.course_code}</Text>
                </View>
                <View style={styles.lectureTime}>
                  <Ionicons name="time-outline" size={14} color="#666" />
                  <Text style={styles.timeText}>{lecture.start_time} - {lecture.end_time}</Text>
                </View>
              </View>

              <View style={styles.lectureStats}>
                <View style={styles.statItem}>
                  <View style={[styles.statDot, { backgroundColor: '#4caf50' }]} />
                  <Text style={styles.statText}>{lecture.present} حاضر</Text>
                </View>
                <View style={styles.statItem}>
                  <View style={[styles.statDot, { backgroundColor: '#f44336' }]} />
                  <Text style={styles.statText}>{lecture.absent} غائب</Text>
                </View>
                <View style={styles.statItem}>
                  <View style={[styles.statDot, { backgroundColor: '#ff9800' }]} />
                  <Text style={styles.statText}>{lecture.late} متأخر</Text>
                </View>
              </View>

              <View style={styles.progressContainer}>
                <View style={styles.progressBar}>
                  <View 
                    style={[
                      styles.progressFill, 
                      { width: `${lecture.attendance_rate}%` },
                      lecture.attendance_rate >= 80 ? styles.progressGood :
                      lecture.attendance_rate >= 60 ? styles.progressMedium : styles.progressLow
                    ]} 
                  />
                </View>
                <Text style={styles.progressText}>{lecture.attendance_rate}%</Text>
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
    flex: 1,
    textAlign: 'center',
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  exportBtn: {
    padding: 4,
  },
  scrollView: {
    flex: 1,
    padding: 16,
  },
  dateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  dateBtn: {
    padding: 8,
  },
  dateDisplay: {
    flex: 1,
    alignItems: 'center',
  },
  dateText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  todayBtn: {
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: '#e3f2fd',
    borderRadius: 12,
  },
  todayBtnText: {
    fontSize: 12,
    color: '#1565c0',
  },
  filterCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
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
  summaryCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  summaryGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  summaryItem: {
    alignItems: 'center',
    flex: 1,
  },
  summaryValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#333',
    marginTop: 4,
  },
  summaryLabel: {
    fontSize: 11,
    color: '#666',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
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
    color: '#999',
  },
  lectureCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  lectureHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  lectureInfo: {
    flex: 1,
  },
  lectureName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  lectureCode: {
    fontSize: 12,
    color: '#666',
  },
  lectureTime: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  timeText: {
    fontSize: 12,
    color: '#666',
  },
  lectureStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 12,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statText: {
    fontSize: 12,
    color: '#666',
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  progressBar: {
    flex: 1,
    height: 8,
    backgroundColor: '#eee',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  progressGood: {
    backgroundColor: '#4caf50',
  },
  progressMedium: {
    backgroundColor: '#ff9800',
  },
  progressLow: {
    backgroundColor: '#f44336',
  },
  progressText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    width: 45,
    textAlign: 'right',
  },
  exportBtn: {
    padding: 4,
  },
});
