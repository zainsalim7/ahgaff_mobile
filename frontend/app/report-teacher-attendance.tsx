import { goBack } from '../src/utils/navigation';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Alert,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Picker } from '@react-native-picker/picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { reportsAPI, departmentsAPI, facultiesAPI } from '../src/services/api';

const STATUS_META: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  executed: { label: 'نُفّذت', color: '#2e7d32', bg: '#e8f5e9', icon: 'checkmark-circle' },
  absent: { label: 'غياب', color: '#c62828', bg: '#ffebee', icon: 'close-circle' },
  cancelled: { label: 'ملغاة', color: '#616161', bg: '#eeeeee', icon: 'remove-circle' },
  pending: { label: 'لم يحن وقتها', color: '#ef6c00', bg: '#fff3e0', icon: 'time' },
};

const getStatusMeta = (status: string) => STATUS_META[status] || { label: status || 'غير معروف', color: '#616161', bg: '#eeeeee', icon: 'help-circle' };

export default function TeacherAttendanceReport() {
  const today = new Date().toISOString().split('T')[0];
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [faculties, setFaculties] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [facultyId, setFacultyId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [viewMode, setViewMode] = useState<'teacher' | 'lecture'>('teacher');
  const [data, setData] = useState<any>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [fRes, dRes] = await Promise.all([facultiesAPI.getAll(), departmentsAPI.getAll()]);
        setFaculties(fRes.data || []);
        setDepartments(dRes.data || []);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, []);

  const filteredDepartments = facultyId
    ? departments.filter((d) => d.faculty_id === facultyId)
    : departments;

  const runReport = useCallback(async () => {
    if (!dateFrom || !dateTo) {
      if (Platform.OS === 'web') window.alert('الرجاء تحديد تاريخ البداية والنهاية');
      else Alert.alert('تنبيه', 'الرجاء تحديد تاريخ البداية والنهاية');
      return;
    }
    let from = dateFrom, to = dateTo;
    if (from > to) { [from, to] = [to, from]; setDateFrom(from); setDateTo(to); }
    setExecuting(true);
    try {
      const params: any = { start_date: from, end_date: to };
      if (departmentId) params.department_id = departmentId;
      if (facultyId) params.faculty_id = facultyId;
      const res = await reportsAPI.getTeacherAttendance(params);
      setData(res.data);
      setHasRun(true);
    } catch (error) {
      console.error('Error:', error);
      if (Platform.OS === 'web') window.alert('فشل في تنفيذ التقرير');
      else Alert.alert('خطأ', 'فشل في تنفيذ التقرير');
    } finally {
      setExecuting(false);
    }
  }, [dateFrom, dateTo, departmentId, facultyId]);

  const downloadBlob = async (blob: Blob, filename: string) => {
    if (Platform.OS === 'web') {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } else {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1];
        const fileUri = FileSystem.documentDirectory + filename;
        await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(fileUri);
      };
      reader.readAsDataURL(blob);
    }
  };

  const handleExport = async (type: 'excel' | 'pdf') => {
    if (!hasRun) { Alert.alert('تنبيه', 'نفّذ التقرير أولاً'); return; }
    setExporting(type);
    try {
      const params: any = { start_date: dateFrom, end_date: dateTo };
      if (departmentId) params.department_id = departmentId;
      if (facultyId) params.faculty_id = facultyId;
      const res = type === 'excel'
        ? await reportsAPI.exportTeacherAttendanceExcel(params)
        : await reportsAPI.exportTeacherAttendancePDF(params);
      const ext = type === 'excel' ? 'xlsx' : 'pdf';
      await downloadBlob(new Blob([res.data]), `teacher_attendance_${dateFrom}_${dateTo}.${ext}`);
    } catch (e) {
      console.error('Export error', e);
      if (Platform.OS === 'web') window.alert('فشل في التصدير');
      else Alert.alert('خطأ', 'فشل في التصدير');
    } finally {
      setExporting(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2e7d32" />
        <Text style={styles.loadingText}>جاري التحميل...</Text>
      </View>
    );
  }

  const summary = data?.summary;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => goBack()} accessibilityLabel="رجوع">
          <Ionicons name="arrow-forward" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>حضور الأساتذة وتنفيذ المحاضرات</Text>
        <View style={styles.headerButtons}>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => handleExport('pdf')}
            disabled={!hasRun || exporting !== null}
            testID="export-teacher-att-pdf"
            accessibilityLabel="تصدير PDF"
          >
            {exporting === 'pdf' ? <ActivityIndicator size="small" color="#e53935" /> :
              <Ionicons name="document-text-outline" size={22} color={hasRun ? '#e53935' : '#ccc'} />}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => handleExport('excel')}
            disabled={!hasRun || exporting !== null}
            testID="export-teacher-att-excel"
            accessibilityLabel="تصدير Excel"
          >
            {exporting === 'excel' ? <ActivityIndicator size="small" color="#2e7d32" /> :
              <Ionicons name="download-outline" size={24} color={hasRun ? '#2e7d32' : '#ccc'} />}
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={styles.scrollView}>
        {/* الفلاتر */}
        <View style={styles.card}>
          <View style={styles.dateRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>من تاريخ</Text>
              {Platform.OS === 'web' ? (
                // @ts-ignore
                <input type="date" value={dateFrom} data-testid="ta-date-from"
                  onChange={(e: any) => setDateFrom(e.target.value)}
                  style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ddd', fontSize: 14, fontFamily: 'inherit' }} />
              ) : (
                <TextInput style={styles.dateBtn} value={dateFrom} onChangeText={setDateFrom} placeholder="YYYY-MM-DD" testID="ta-date-from" />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>إلى تاريخ</Text>
              {Platform.OS === 'web' ? (
                // @ts-ignore
                <input type="date" value={dateTo} data-testid="ta-date-to"
                  onChange={(e: any) => setDateTo(e.target.value)}
                  style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ddd', fontSize: 14, fontFamily: 'inherit' }} />
              ) : (
                <TextInput style={styles.dateBtn} value={dateTo} onChangeText={setDateTo} placeholder="YYYY-MM-DD" testID="ta-date-to" />
              )}
            </View>
          </View>
          <TouchableOpacity
            style={styles.todayChip}
            onPress={() => { setDateFrom(today); setDateTo(today); }}
            testID="today-chip"
          >
            <Ionicons name="today" size={14} color="#1565c0" />
            <Text style={styles.todayChipText}>اليوم</Text>
          </TouchableOpacity>

          <Text style={styles.fieldLabel}>الكلية</Text>
          <View style={styles.pickerWrapper}>
            <Picker
              selectedValue={facultyId}
              onValueChange={(v) => { setFacultyId(v); setDepartmentId(''); }}
              style={styles.picker}
            >
              <Picker.Item label="جميع الكليات" value="" />
              {faculties.map((f) => <Picker.Item key={f.id} label={f.name} value={f.id} />)}
            </Picker>
          </View>

          <Text style={styles.fieldLabel}>القسم</Text>
          <View style={styles.pickerWrapper}>
            <Picker
              selectedValue={departmentId}
              onValueChange={setDepartmentId}
              style={styles.picker}
            >
              <Picker.Item label="جميع الأقسام" value="" />
              {filteredDepartments.map((d) => <Picker.Item key={d.id} label={d.name} value={d.id} />)}
            </Picker>
          </View>

          <TouchableOpacity
            style={[styles.runBtn, executing && { opacity: 0.7 }]}
            onPress={runReport}
            disabled={executing}
            testID="run-report-btn"
          >
            {executing ? (
              <><ActivityIndicator size="small" color="#fff" /><Text style={styles.runBtnText}>جاري التنفيذ...</Text></>
            ) : (
              <><Ionicons name="play" size={18} color="#fff" /><Text style={styles.runBtnText}>{hasRun ? 'إعادة التنفيذ' : 'تنفيذ التقرير'}</Text></>
            )}
          </TouchableOpacity>
        </View>

        {!hasRun && !executing && (
          <View style={styles.emptyCard}>
            <Ionicons name="information-circle-outline" size={48} color="#90a4ae" />
            <Text style={styles.emptyText}>اختر الفترة والفلاتر ثم اضغط "تنفيذ التقرير"</Text>
          </View>
        )}

        {/* الملخص */}
        {summary && (
          <View style={styles.summaryCard}>
            <View style={styles.summaryGrid}>
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryValue, { color: '#1565c0' }]}>{summary.total_lectures}</Text>
                <Text style={styles.summaryLabel}>محاضرة</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryValue, { color: '#2e7d32' }]}>{summary.executed}</Text>
                <Text style={styles.summaryLabel}>نُفّذت</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryValue, { color: '#c62828' }]}>{summary.absent}</Text>
                <Text style={styles.summaryLabel}>غياب</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryValue, { color: '#616161' }]}>{summary.cancelled}</Text>
                <Text style={styles.summaryLabel}>ملغاة</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryValue, { color: '#ef6c00' }]}>{summary.execution_rate}%</Text>
                <Text style={styles.summaryLabel}>نسبة التنفيذ</Text>
              </View>
            </View>
          </View>
        )}

        {/* مبدّل العرض */}
        {hasRun && (
          <View style={styles.tabRow}>
            <TouchableOpacity
              style={[styles.tab, viewMode === 'teacher' && styles.tabActive]}
              onPress={() => setViewMode('teacher')}
              testID="tab-by-teacher"
            >
              <Ionicons name="person" size={16} color={viewMode === 'teacher' ? '#fff' : '#555'} />
              <Text style={[styles.tabText, viewMode === 'teacher' && styles.tabTextActive]}>حسب الأستاذ</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, viewMode === 'lecture' && styles.tabActive]}
              onPress={() => setViewMode('lecture')}
              testID="tab-by-lecture"
            >
              <Ionicons name="list" size={16} color={viewMode === 'lecture' ? '#fff' : '#555'} />
              <Text style={[styles.tabText, viewMode === 'lecture' && styles.tabTextActive]}>حسب المحاضرات</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* حسب الأستاذ */}
        {hasRun && viewMode === 'teacher' && (
          data.teachers.length === 0 ? (
            <View style={styles.emptyCard}><Text style={styles.emptyText}>لا توجد محاضرات في هذه الفترة</Text></View>
          ) : data.teachers.map((t: any) => {
            const isExp = expanded === (t.teacher_id || t.teacher_name);
            const key = t.teacher_id || t.teacher_name;
            return (
              <View key={key} style={styles.teacherCard}>
                <TouchableOpacity
                  style={styles.teacherHeader}
                  onPress={() => setExpanded(isExp ? null : key)}
                  testID={`teacher-att-${key}`}
                >
                  <View style={styles.teacherInfo}>
                    <View style={styles.avatar}><Ionicons name="person" size={18} color="#fff" /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.teacherName}>{t.teacher_name}</Text>
                      {!!t.employee_id && <Text style={styles.teacherId}>{t.employee_id}</Text>}
                    </View>
                    <Ionicons name={isExp ? 'chevron-up' : 'chevron-down'} size={20} color="#999" />
                  </View>
                  <View style={styles.badgeRow}>
                    <View style={[styles.badge, { backgroundColor: '#e8f5e9' }]}><Text style={[styles.badgeText, { color: '#2e7d32' }]}>نُفّذت {t.executed}</Text></View>
                    <View style={[styles.badge, { backgroundColor: '#ffebee' }]}><Text style={[styles.badgeText, { color: '#c62828' }]}>غياب {t.absent}</Text></View>
                    {t.cancelled > 0 && <View style={[styles.badge, { backgroundColor: '#eeeeee' }]}><Text style={[styles.badgeText, { color: '#616161' }]}>ملغاة {t.cancelled}</Text></View>}
                    <View style={[styles.badge, { backgroundColor: '#e3f2fd' }]}><Text style={[styles.badgeText, { color: '#1565c0' }]}>{t.execution_rate}%</Text></View>
                  </View>
                </TouchableOpacity>
                {isExp && (
                  <View style={styles.detailBox}>
                    {t.lectures.map((l: any) => (
                      <View key={l.lecture_id} style={styles.lectureRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.lecCourse}>{l.course_name}</Text>
                          <Text style={styles.lecMeta}>{l.date} · {l.start_time}-{l.end_time}{l.section ? ` · شعبة ${l.section}` : ''}</Text>
                        </View>
                        <View style={[styles.statusPill, { backgroundColor: getStatusMeta(l.status).bg }]}>
                          <Ionicons name={getStatusMeta(l.status).icon} size={13} color={getStatusMeta(l.status).color} />
                          <Text style={[styles.statusPillText, { color: getStatusMeta(l.status).color }]}>{getStatusMeta(l.status).label}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          })
        )}

        {/* حسب المحاضرات */}
        {hasRun && viewMode === 'lecture' && (
          data.lectures.length === 0 ? (
            <View style={styles.emptyCard}><Text style={styles.emptyText}>لا توجد محاضرات في هذه الفترة</Text></View>
          ) : data.lectures.map((l: any) => (
            <View key={l.lecture_id} style={styles.flatCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.lecCourse}>{l.course_name}</Text>
                <Text style={styles.lecMeta}>{l.teacher_name} · {l.department_name}</Text>
                <Text style={styles.lecMeta}>{l.date} · {l.start_time}-{l.end_time}{l.section ? ` · شعبة ${l.section}` : ''}</Text>
              </View>
              <View style={[styles.statusPill, { backgroundColor: getStatusMeta(l.status).bg }]}>
                <Ionicons name={getStatusMeta(l.status).icon} size={13} color={getStatusMeta(l.status).color} />
                <Text style={[styles.statusPillText, { color: getStatusMeta(l.status).color }]}>{getStatusMeta(l.status).label}</Text>
              </View>
            </View>
          ))
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 10, fontSize: 16, color: '#666' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee' },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#333', flex: 1, textAlign: 'center' },
  headerButtons: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: { padding: 4 },
  scrollView: { flex: 1, padding: 16 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 16 },
  dateRow: { flexDirection: 'row', gap: 10 },
  fieldLabel: { fontSize: 13, color: '#666', marginBottom: 6, marginTop: 12 },
  dateBtn: { backgroundColor: '#f5f5f5', borderRadius: 8, padding: 12 },
  todayChip: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: '#e3f2fd', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, marginTop: 10 },
  todayChipText: { fontSize: 12, color: '#1565c0', fontWeight: '600' },
  pickerWrapper: { backgroundColor: '#f5f5f5', borderRadius: 8, overflow: 'hidden' },
  picker: { height: 45 },
  runBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#2e7d32', paddingVertical: 12, borderRadius: 10, marginTop: 16 },
  runBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  emptyCard: { backgroundColor: '#fff', borderRadius: 12, padding: 32, alignItems: 'center', marginBottom: 12 },
  emptyText: { marginTop: 10, fontSize: 15, fontWeight: '600', color: '#455a64', textAlign: 'center' },
  summaryCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16 },
  summaryGrid: { flexDirection: 'row', justifyContent: 'space-between' },
  summaryItem: { alignItems: 'center', flex: 1 },
  summaryValue: { fontSize: 20, fontWeight: '800' },
  summaryLabel: { fontSize: 11, color: '#666', marginTop: 4, textAlign: 'center' },
  tabRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#fff', paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#e0e0e0' },
  tabActive: { backgroundColor: '#2e7d32', borderColor: '#2e7d32' },
  tabText: { fontSize: 14, fontWeight: '600', color: '#555' },
  tabTextActive: { color: '#fff' },
  teacherCard: { backgroundColor: '#fff', borderRadius: 14, marginBottom: 12, overflow: 'hidden' },
  teacherHeader: { padding: 14 },
  teacherInfo: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#2e7d32', justifyContent: 'center', alignItems: 'center' },
  teacherName: { fontSize: 16, fontWeight: '700', color: '#333' },
  teacherId: { fontSize: 12, color: '#888' },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  detailBox: { borderTopWidth: 1, borderTopColor: '#f0f0f0', paddingHorizontal: 14, paddingVertical: 8 },
  lectureRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f5f5f5', gap: 8 },
  lecCourse: { fontSize: 14, fontWeight: '600', color: '#333' },
  lecMeta: { fontSize: 12, color: '#999', marginTop: 2 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12 },
  statusPillText: { fontSize: 12, fontWeight: '700' },
  flatCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
});
