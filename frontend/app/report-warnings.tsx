import { goBack } from '../src/utils/navigation';
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Picker } from '@react-native-picker/picker';
import { reportsAPI, departmentsAPI } from '../src/services/api';
import { useAuth } from '../src/contexts/AuthContext';
import { ReportHero, ReportKpis, ReportFilters, ReportEmpty, downloadReport, reportPage } from '../src/components/reports/ReportShell';

export default function WarningsReport() {
  const { hasPermission } = useAuth();
  const [metaLoading, setMetaLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [warnings, setWarnings] = useState<any[]>([]);
  const [deprivations, setDeprivations] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [selectedDept, setSelectedDept] = useState('');
  const [summary, setSummary] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'warnings' | 'deprivations'>('warnings');
  const [exporting, setExporting] = useState<'' | 'pdf' | 'excel'>('');

  const deptName = selectedDept ? departments.find(d => d.id === selectedDept)?.name : undefined;

  const handleExport = async (fmt: 'pdf' | 'excel') => {
    setExporting(fmt);
    const params: any = {}
    if (selectedDept) params.department_id = selectedDept;
    await downloadReport(fmt === 'pdf' ? '/reports/warnings/export-pdf' : '/export/report/warnings/excel', params, ['تقرير الإنذارات والحرمان', deptName], fmt === 'pdf' ? 'pdf' : 'xlsx');
    setExporting('');
  };

  useEffect(() => {
    (async () => {
      try {
        const deptsRes = await departmentsAPI.getAll();
        setDepartments(deptsRes.data);
      } catch (e) { console.error(e); }
      finally { setMetaLoading(false); }
    })();
  }, []);

  const runReport = useCallback(async () => {
    setExecuting(true);
    try {
      const params: any = {}
      if (selectedDept) params.department_id = selectedDept;
      const reportRes = await reportsAPI.getWarningsReport(params);
      setWarnings(reportRes.data.warnings || []);
      setDeprivations(reportRes.data.deprivations || []);
      setSummary(reportRes.data.summary);
      setHasRun(true);
    } catch (error) {
      console.error('Error running report:', error);
      alert('فشل في تنفيذ التقرير');
    } finally {
      setExecuting(false);
      setRefreshing(false);
    }
  }, [selectedDept]);

  const onRefresh = () => {
    if (!hasRun) return;
    setRefreshing(true);
    runReport();
  };

  if (metaLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#ff9800" />
        <Text style={styles.loadingText}>جاري تحميل الفلاتر...</Text>
      </View>
    );
  }

  const currentList = activeTab === 'warnings' ? warnings : deprivations;
  const total = warnings.length + deprivations.length;


  return (
    <SafeAreaView style={reportPage.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={reportPage.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <ReportHero
          title="الإنذارات والحرمان"
          subtitle="الطلاب الذين تجاوزت نسبة غيابهم حد الإنذار أو حد الحرمان في أي مقرر"
          onBack={() => goBack()}
          canExport={hasRun && total > 0 && hasPermission('export_reports')}
          onPdf={() => handleExport('pdf')}
          onExcel={() => handleExport('excel')}
          exporting={exporting}
          testID="warnings-hero"
        />

        <ReportFilters onRun={runReport} running={executing} hasRun={hasRun}>
          <View style={{ flex: 1, minWidth: 220 }}>
            <Text style={reportPage.label}>القسم</Text>
            <View style={reportPage.pickerBox}>
              <Picker selectedValue={selectedDept} onValueChange={setSelectedDept} style={reportPage.picker}>
                <Picker.Item label="جميع الأقسام" value="" />
                {departments.map(d => <Picker.Item key={d.id} label={d.name} value={d.id} />)}
              </Picker>
            </View>
          </View>
        </ReportFilters>
        {!!summary?.rule && (
          <View style={{ backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', borderRadius: 10, padding: 10, marginBottom: 12 }} testID="warnings-rule">
            <Text style={{ fontSize: 12, color: '#1e3a8a', textAlign: 'right', lineHeight: 18, fontWeight: '700' }}>📐 {summary.rule}</Text>
            <Text style={{ fontSize: 11, color: '#1e40af', textAlign: 'right', marginTop: 4 }}>الحدود تُضبط من إعدادات الكلية (تبويب الإعدادات) · «مؤشر مبكر» = أقل من {summary.min_executed} محاضرات منفَّذة</Text>
          </View>
        )}

        {!hasRun && !executing && <ReportEmpty text="اختر الفلاتر ثم اضغط «تنفيذ التقرير» — سيعرض الطلاب الذين يستحقون إنذاراً أو حرماناً" icon="information-circle-outline" />}
        {executing && !refreshing && <ActivityIndicator size="large" color="#1565c0" style={{ marginTop: 30 }} />}

        {hasRun && !executing && summary && (
          <ReportKpis items={[
            { label: 'إنذار / خطر', value: summary.total_warnings, color: '#f97316', icon: 'warning', sub: `اقترب من الحد (≥ 60%)` },
            { label: 'مرشَّح للحرمان', value: summary.total_deprivations, color: '#dc2626', icon: 'close-circle', sub: `بلا عذر > ${summary.unexcused_limit}% أو الإجمالي > ${summary.total_limit}%` },
            { label: 'إجمالي الحالات', value: total, color: '#1565c0', icon: 'people', sub: `${new Set([...warnings, ...deprivations].map(s => s.student_id)).size} طالباً` },
          ]} />
        )}

        {hasRun && !executing && (<>
          <View style={styles.tabsContainer}>
            <TouchableOpacity style={[styles.tab, activeTab === 'warnings' && styles.tabActive]} onPress={() => setActiveTab('warnings')} testID="tab-warnings">
              <Ionicons name="warning" size={18} color={activeTab === 'warnings' ? '#f97316' : '#999'} />
              <Text style={[styles.tabText, activeTab === 'warnings' && styles.tabTextActive]}>الإنذارات ({warnings.length})</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.tab, activeTab === 'deprivations' && styles.tabActiveDanger]} onPress={() => setActiveTab('deprivations')} testID="tab-deprivations">
              <Ionicons name="close-circle" size={18} color={activeTab === 'deprivations' ? '#dc2626' : '#999'} />
              <Text style={[styles.tabText, activeTab === 'deprivations' && styles.tabTextActiveDanger]}>المحرومون ({deprivations.length})</Text>
            </TouchableOpacity>
          </View>

          {currentList.length === 0 ? (
            <ReportEmpty text={activeTab === 'warnings' ? 'لا يوجد إنذارات' : 'لا يوجد محرومون'} icon="checkmark-circle-outline" />
          ) : currentList.map((item, index) => (
            <View key={index} style={[styles.studentCard, activeTab === 'deprivations' && styles.studentCardDanger]} testID={`warning-row-${index}`}>
              <View style={styles.studentHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.studentName}>{item.student_name}</Text>
                  <Text style={styles.studentId}>{item.student_id}</Text>
                </View>
                <View style={[styles.statusBadge, item.status === 'محروم' ? styles.statusDanger : styles.statusWarning]}>
                  <Text style={[styles.statusText, { color: item.status === 'محروم' ? '#dc2626' : '#c2410c' }]}>{item.status}</Text>
                </View>
              </View>
              <View style={styles.courseInfo}>
                <Ionicons name="book-outline" size={16} color="#666" />
                <Text style={styles.courseName}>{item.course_name}</Text>
                <Text style={styles.courseCode}>({item.course_code})</Text>
              </View>
              <View style={styles.statsRow}>
                <View style={styles.statItem}><Text style={styles.statValue}>{item.total_lectures}</Text><Text style={styles.statLabel}>منفَّذة ({item.executed_hours} س)</Text></View>
                <View style={styles.statItem}><Text style={[styles.statValue, { color: item.exceeded_unexcused ? '#dc2626' : '#111827' }]}>{item.pct_unexcused}%</Text><Text style={styles.statLabel}>بلا عذر ({item.unexcused_hours} س)</Text></View>
                <View style={styles.statItem}><Text style={[styles.statValue, { color: item.exceeded_total ? '#dc2626' : '#111827' }]}>{item.pct_total}%</Text><Text style={styles.statLabel}>الإجمالي (بعذر {item.excused_hours} س)</Text></View>
                <View style={styles.statItem}>
                  <Text style={[styles.statValue, { color: item.remaining_allowed > 0 ? '#16a34a' : '#dc2626' }]}>{item.remaining_allowed}</Text>
                  <Text style={styles.statLabel}>س متبقية بلا عذر</Text>
                </View>
              </View>
              {item.early && <Text style={{ fontSize: 11, color: '#64748b', textAlign: 'right', marginTop: 4 }}>مؤشر مبكر — محاضرات منفَّذة قليلة</Text>}
            </View>
          ))}
        </>)}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 10, fontSize: 16, color: '#666' },
  chipRow: { flexDirection: 'row-reverse', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0' },
  chipText: { fontSize: 12, color: '#666', fontWeight: '600' },
  tabsContainer: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 12, padding: 4, marginBottom: 12, borderWidth: 1, borderColor: '#e6ebf2' },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 11, borderRadius: 10, gap: 6 },
  tabActive: { backgroundColor: '#fff3e0' },
  tabActiveDanger: { backgroundColor: '#ffebee' },
  tabText: { fontSize: 13, color: '#999', fontWeight: '600' },
  tabTextActive: { color: '#f97316', fontWeight: '800' },
  tabTextActiveDanger: { color: '#dc2626', fontWeight: '800' },
  studentCard: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 10, borderRightWidth: 4, borderRightColor: '#f97316', borderWidth: 1, borderColor: '#e6ebf2' },
  studentCardDanger: { borderRightColor: '#dc2626' },
  studentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  studentName: { fontSize: 16, fontWeight: '700', color: '#0f2440' },
  studentId: { fontSize: 12, color: '#666' },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  statusWarning: { backgroundColor: '#fff3e0' },
  statusDanger: { backgroundColor: '#ffebee' },
  statusText: { fontSize: 12, fontWeight: '800' },
  courseInfo: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12, backgroundColor: '#f5f7fa', padding: 8, borderRadius: 8 },
  courseName: { fontSize: 13, color: '#333', flex: 1 },
  courseCode: { fontSize: 11, color: '#999' },
  statsRow: { flexDirection: 'row', justifyContent: 'space-around' },
  statItem: { alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '700', color: '#333' },
  statLabel: { fontSize: 11, color: '#666' },
});
