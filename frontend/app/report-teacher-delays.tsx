import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Picker } from '@react-native-picker/picker';
import { useRouter } from 'expo-router';
import api, { departmentsAPI } from '../src/services/api';
import { useAuth } from '../src/contexts/AuthContext';

interface TeacherDelay {
  teacher_id: string;
  teacher_name: string;
  employee_id: string;
  total_lectures: number;
  delayed_lectures: number;
  total_delay_minutes: number;
  avg_delay_minutes: number;
  max_delay_minutes: number;
  delays: Array<{
    date: string;
    course_name: string;
    start_time: string;
    started_at: string;
    delay_minutes: number;
  }>;
}

export default function TeacherDelaysReport() {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [teachers, setTeachers] = useState<TeacherDelay[]>([]);
  const [summary, setSummary] = useState({ total_teachers: 0, total_delayed_teachers: 0, total_delay_incidents: 0 });
  const [departments, setDepartments] = useState<any[]>([]);
  const [filterDept, setFilterDept] = useState('');
  const [expandedTeacher, setExpandedTeacher] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // تحميل الأقسام فقط
  useEffect(() => {
    (async () => {
      try {
        const dRes = await departmentsAPI.getAll();
        setDepartments(dRes.data || []);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, []);

  const fetchData = useCallback(async () => {
    setExecuting(true);
    try {
      const params = new URLSearchParams();
      if (filterDept) params.append('department_id', filterDept);
      const reportRes = await api.get(`/reports/teacher-delays?${params.toString()}`);
      setTeachers(reportRes.data.teachers || []);
      setSummary(reportRes.data.summary || {});
      setHasRun(true);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setExecuting(false);
    }
  }, [filterDept]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (filterDept) params.append('department_id', filterDept);
      const response = await api.get(`/reports/teacher-delays/export?${params.toString()}`, { responseType: 'blob' });
      if (Platform.OS === 'web') {
        const url = window.URL.createObjectURL(new Blob([response.data]));
        const a = document.createElement('a');
        a.href = url;
        const xf = (response.headers as any)?.['x-filename'];
        a.download = xf ? decodeURIComponent(xf) : 'teacher_delays_report.xlsx';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('Export error:', error);
    } finally {
      setExporting(false);
    }
  };

  const getDelayColor = (minutes: number) => {
    if (minutes === 0) return '#4caf50';
    if (minutes <= 5) return '#ff9800';
    if (minutes <= 15) return '#f44336';
    return '#b71c1c';
  };

  const renderTeacher = ({ item }: { item: TeacherDelay }) => {
    const isExpanded = expandedTeacher === item.teacher_id;
    const delayPercent = item.total_lectures > 0 ? Math.round((item.delayed_lectures / item.total_lectures) * 100) : 0;
    
    return (
      <View style={styles.card}>
        <TouchableOpacity 
          style={styles.cardHeader}
          onPress={() => setExpandedTeacher(isExpanded ? null : item.teacher_id)}
          data-testid={`teacher-delay-${item.employee_id}`}
        >
          <View style={styles.teacherInfo}>
            <View style={styles.avatarCircle}>
              <Ionicons name="person" size={20} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.teacherName}>{item.teacher_name}</Text>
              <Text style={styles.employeeId}>{item.employee_id}</Text>
            </View>
          </View>
          
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{item.total_lectures}</Text>
              <Text style={styles.statLabel}>محاضرة</Text>
            </View>
            <View style={[styles.statItem, { backgroundColor: item.delayed_lectures > 0 ? '#ffebee' : '#e8f5e9' }]}>
              <Text style={[styles.statValue, { color: item.delayed_lectures > 0 ? '#f44336' : '#4caf50' }]}>
                {item.delayed_lectures}
              </Text>
              <Text style={styles.statLabel}>تأخر</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: getDelayColor(item.avg_delay_minutes) }]}>
                {item.avg_delay_minutes}
              </Text>
              <Text style={styles.statLabel}>متوسط (د)</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: getDelayColor(item.max_delay_minutes) }]}>
                {item.max_delay_minutes}
              </Text>
              <Text style={styles.statLabel}>أقصى (د)</Text>
            </View>
          </View>
          
          {/* شريط نسبة التأخر */}
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${delayPercent}%`, backgroundColor: getDelayColor(item.avg_delay_minutes) }]} />
          </View>
          <Text style={styles.progressText}>نسبة التأخر: {delayPercent}%</Text>
          
          <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={20} color="#999" />
        </TouchableOpacity>
        
        {isExpanded && item.delays.length > 0 && (
          <View style={styles.detailsContainer}>
            <Text style={styles.detailsTitle}>تفاصيل التأخيرات</Text>
            {item.delays.map((d, i) => (
              <View key={i} style={styles.delayRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.delayCourseName}>{d.course_name}</Text>
                  <Text style={styles.delayDate}>{d.date}</Text>
                </View>
                <View style={styles.delayTimeInfo}>
                  <Text style={styles.delayTimeLabel}>المحدد: {d.start_time}</Text>
                  <Text style={styles.delayTimeLabel}>الفعلي: {d.started_at}</Text>
                </View>
                <View style={[styles.delayBadge, { backgroundColor: getDelayColor(d.delay_minutes) + '20' }]}>
                  <Text style={[styles.delayBadgeText, { color: getDelayColor(d.delay_minutes) }]}>
                    {d.delay_minutes} د
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
        
        {isExpanded && item.delays.length === 0 && (
          <View style={styles.detailsContainer}>
            <Text style={{ textAlign: 'center', color: '#4caf50', padding: 12 }}>لا يوجد تأخيرات</Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="رجوع">
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>تقرير تأخر المعلمين</Text>
        {hasPermission('export_reports') && (
          <TouchableOpacity 
            style={styles.exportBtn} 
            onPress={handleExport}
            disabled={exporting}
            data-testid="export-teacher-delays-btn"
            accessibilityLabel="تصدير Excel"
          >
            {exporting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Ionicons name="download-outline" size={20} color="#fff" />
            )}
          </TouchableOpacity>
        )}
      </View>

      {/* ملخص */}
      <View style={styles.summaryRow}>
        <View style={[styles.summaryCard, { backgroundColor: '#e3f2fd' }]}>
          <Ionicons name="people" size={24} color="#1565c0" />
          <Text style={styles.summaryValue}>{summary.total_teachers}</Text>
          <Text style={styles.summaryLabel}>معلم</Text>
        </View>
        <View style={[styles.summaryCard, { backgroundColor: '#fff3e0' }]}>
          <Ionicons name="warning" size={24} color="#ff9800" />
          <Text style={styles.summaryValue}>{summary.total_delayed_teachers}</Text>
          <Text style={styles.summaryLabel}>متأخرين</Text>
        </View>
        <View style={[styles.summaryCard, { backgroundColor: '#ffebee' }]}>
          <Ionicons name="time" size={24} color="#f44336" />
          <Text style={styles.summaryValue}>{summary.total_delay_incidents}</Text>
          <Text style={styles.summaryLabel}>حالة تأخر</Text>
        </View>
      </View>

      {/* فلتر القسم */}
      <View style={styles.filterRow}>
        <Picker
          selectedValue={filterDept}
          onValueChange={setFilterDept}
          style={styles.picker}
        >
          <Picker.Item label="جميع الأقسام" value="" />
          {departments.map(d => (
            <Picker.Item key={d.id} label={d.name} value={d.id} />
          ))}
        </Picker>
      </View>

      {/* زر التنفيذ */}
      <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
        <TouchableOpacity
          style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#1565c0', paddingVertical: 12, borderRadius: 10 }, executing && { opacity: 0.7 }]}
          onPress={fetchData}
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

      {/* القائمة */}
      {loading || executing ? (
        <ActivityIndicator size="large" color="#1565c0" style={{ marginTop: 40 }} />
      ) : !hasRun ? (
        <View style={styles.emptyState}>
          <Ionicons name="information-circle-outline" size={60} color="#90a4ae" />
          <Text style={styles.emptyText}>اضغط "تنفيذ التقرير" لعرض البيانات</Text>
        </View>
      ) : teachers.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="checkmark-circle" size={60} color="#4caf50" />
          <Text style={styles.emptyText}>لا توجد بيانات تأخر</Text>
          <Text style={styles.emptySubtext}>سيظهر التقرير عندما يبدأ المعلمون بالتحضير</Text>
        </View>
      ) : (
        <FlatList
          data={teachers}
          keyExtractor={item => item.teacher_id}
          renderItem={renderTeacher}
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e0e0e0' },
  backBtn: { padding: 4, marginRight: 12 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700', color: '#333' },
  exportBtn: { backgroundColor: '#1565c0', padding: 10, borderRadius: 10 },
  summaryRow: { flexDirection: 'row', padding: 16, gap: 10 },
  summaryCard: { flex: 1, padding: 14, borderRadius: 12, alignItems: 'center', gap: 4 },
  summaryValue: { fontSize: 22, fontWeight: '800', color: '#333' },
  summaryLabel: { fontSize: 12, color: '#666' },
  filterRow: { paddingHorizontal: 16, paddingBottom: 8 },
  picker: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#e0e0e0' },
  card: { backgroundColor: '#fff', borderRadius: 14, marginBottom: 12, overflow: 'hidden', elevation: 2 },
  cardHeader: { padding: 16 },
  teacherInfo: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 10 },
  avatarCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#1565c0', justifyContent: 'center', alignItems: 'center' },
  teacherName: { fontSize: 16, fontWeight: '700', color: '#333' },
  employeeId: { fontSize: 13, color: '#888' },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  statItem: { flex: 1, backgroundColor: '#f8f9fa', padding: 8, borderRadius: 8, alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '800', color: '#333' },
  statLabel: { fontSize: 11, color: '#888', marginTop: 2 },
  progressBar: { height: 6, backgroundColor: '#e0e0e0', borderRadius: 3, marginBottom: 4 },
  progressFill: { height: 6, borderRadius: 3 },
  progressText: { fontSize: 11, color: '#999', textAlign: 'left' },
  detailsContainer: { borderTopWidth: 1, borderTopColor: '#f0f0f0', padding: 12 },
  detailsTitle: { fontSize: 14, fontWeight: '700', color: '#555', marginBottom: 10 },
  delayRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f5f5f5', gap: 8 },
  delayCourseName: { fontSize: 14, fontWeight: '600', color: '#333' },
  delayDate: { fontSize: 12, color: '#999' },
  delayTimeInfo: { alignItems: 'flex-end' },
  delayTimeLabel: { fontSize: 12, color: '#666' },
  delayBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, minWidth: 50, alignItems: 'center' },
  delayBadgeText: { fontSize: 14, fontWeight: '800' },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyText: { fontSize: 18, fontWeight: '700', color: '#333', marginTop: 16 },
  emptySubtext: { fontSize: 14, color: '#999', marginTop: 8, textAlign: 'center' },
});
