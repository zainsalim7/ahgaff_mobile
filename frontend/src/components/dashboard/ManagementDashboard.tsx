import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl, useWindowDimensions, Platform, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import api from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { exportName, filenameFromResponse } from '../../utils/exportName';
import { DASH } from './dashTheme';
import { DashHeader } from './DashHeader';
import { DashScopeFilter } from './DashScopeFilter';
import { DashKpis } from './DashKpis';
import { DashAlerts } from './DashAlerts';
import { DashAttendanceChart } from './DashAttendanceChart';
import { DashFinance } from './DashFinance';
import { DashTeachers } from './DashTeachers';
import { DashStudents } from './DashStudents';
import { DashRooms } from './DashRooms';

type Period = 'day' | 'week' | 'month';

export const ManagementDashboard = () => {
  const { user } = useAuthStore();
  const { width } = useWindowDimensions();
  const compact = width < 760;

  const [period, setPeriod] = useState<Period>('week');
  const [facultyId, setFacultyId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState<'' | 'pdf' | 'excel'>('');

  const params = { period, faculty_id: facultyId || undefined, department_id: departmentId || undefined };

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const res = await api.get('/dashboard/management', { params: { period, faculty_id: facultyId || undefined, department_id: departmentId || undefined } });
      setData(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'تعذر تحميل لوحة القيادة');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [period, facultyId, departmentId]);

  useEffect(() => { load(); }, [load]);

  const onExport = async (fmt: 'pdf' | 'excel') => {
    setExporting(fmt);
    try {
      const res = await api.get('/dashboard/management/export', { params: { ...params, fmt }, responseType: 'blob' });
      const name = filenameFromResponse(res, exportName(['لوحة القيادة', data?.scope?.label, data?.period_label], fmt === 'pdf' ? 'pdf' : 'xlsx'));
      if (Platform.OS === 'web') {
        const url = window.URL.createObjectURL(new Blob([res.data]));
        const a = document.createElement('a');
        a.href = url; a.download = name; a.click();
        window.URL.revokeObjectURL(url);
      } else {
        const path = `${FileSystem.documentDirectory}${name}`;
        const reader = new FileReader();
        reader.onloadend = async () => {
          await FileSystem.writeAsStringAsync(path, (reader.result as string).split(',')[1], { encoding: FileSystem.EncodingType.Base64 });
          await Sharing.shareAsync(path);
        };
        reader.readAsDataURL(new Blob([res.data]));
      }
    } catch {
      setError('تعذر تصدير اللوحة');
    } finally {
      setExporting('');
    }
  };

  const onScope = (f: string, d: string) => { setFacultyId(f); setDepartmentId(d); };

  if (loading && !data) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}><ActivityIndicator size="large" color={DASH.navy} /><Text style={styles.loadingText}>جارٍ تجهيز لوحة القيادة…</Text></View>
      </SafeAreaView>
    );
  }

  if (error && !data) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center} testID="dash-error">
          <Ionicons name="cloud-offline-outline" size={48} color="#cbd5e1" />
          <Text style={styles.errText}>{error}</Text>
          <TouchableOpacity style={styles.retry} onPress={() => load()} testID="dash-retry-btn"><Text style={styles.retryText}>إعادة المحاولة</Text></TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const semester = data?.semester?.name ? `${data.semester.name}` : '';
  const twoCol = width >= 1100;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={[styles.content, { maxWidth: 1400, alignSelf: 'center', width: '100%' }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} />}
        testID="management-dashboard"
      >
        <DashHeader
          userName={user?.full_name}
          scopeLabel={data?.scope?.label || ''}
          semester={semester}
          generatedAt={data?.generated_at || ''}
          period={period}
          onPeriod={setPeriod}
          exporting={exporting}
          onExport={onExport}
          onRefresh={() => load(true)}
          compact={compact}
          readOnly={!!data?.scope?.read_only}
        />
        {data?.scope?.can_filter && (
          <DashScopeFilter faculties={data.scope.faculties} departments={data.scope.departments} facultyId={facultyId} departmentId={departmentId} onChange={onScope} />
        )}
        {!!error && <View style={styles.inlineErr} testID="dash-inline-error"><Text style={styles.inlineErrText}>{error}</Text></View>}
        {loading && <View style={styles.overlay}><ActivityIndicator color={DASH.navy} /></View>}
        {data && (
          <>
            <DashKpis n={data.numbers} periodLabel={data.period_label} compact={compact} />
            <DashAlerts alerts={data.alerts} />
            <DashAttendanceChart groupBy={data.chart.group_by} points={data.chart.points} periodLabel={data.period_label} width={Math.min(width, 1400) - 64} />
            {data.teachers && <DashTeachers t={data.teachers} periodLabel={data.period_label} />}
            <View style={[styles.cols, twoCol && { flexDirection: 'row-reverse' }]}>
              {data.students && <View style={{ flex: 1 }}><DashStudents s={data.students} periodLabel={data.period_label} /></View>}
              {data.rooms && <View style={{ flex: 1 }}><DashRooms r={data.rooms} /></View>}
            </View>
            {data.finance && <DashFinance f={data.finance} />}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: DASH.bg },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  loadingText: { color: DASH.muted, fontSize: 13 },
  errText: { color: DASH.red, fontSize: 14, textAlign: 'center' },
  retry: { backgroundColor: DASH.navy, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10 },
  retryText: { color: '#fff', fontWeight: '700' },
  inlineErr: { backgroundColor: '#fef2f2', borderColor: '#fecaca', borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 12 },
  inlineErrText: { color: DASH.red, textAlign: 'right', fontSize: 12 },
  overlay: { alignItems: 'center', paddingVertical: 6 },
  cols: { gap: 16 },
});
