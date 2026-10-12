import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { goBack } from '../src/utils/navigation';
import api from '../src/services/api';
import { ReportHero, reportPage } from '../src/components/reports/ReportShell';
import { DASH } from '../src/components/dashboard/dashTheme';

const TYPE_COLOR: Record<string, string> = { created: '#15803d', lecture_change: '#b45309', reschedule: '#1d4ed8', cancel: '#b91c1c', lock: '#6d28d9', activity: '#475569' };
const TYPES = [['', 'الكل'], ['created', 'إنشاء'], ['lecture_change', 'تغيير وقت/حالة'], ['reschedule', 'إعادة جدولة'], ['cancel', 'إلغاء'], ['activity', 'أحداث الجدول/النظام']];

export default function CourseHistoryPage() {
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState('');
  const [type, setType] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!courseId) return;
    api.get(`/courses/${courseId}/history`).then((r) => setData(r.data)).catch((e) => setErr(e?.response?.data?.detail || 'تعذر تحميل السجل'));
  }, [courseId]);

  const events = useMemo(() => {
    const list = (data?.events || []).slice().reverse();
    return list.filter((e: any) => (!type || e.type === type) && (!q || `${e.summary} ${e.by} ${e.action_ar}`.includes(q)));
  }, [data, type, q]);

  const badSlots = (data?.slots || []).filter((s: any) => s.issues?.length);

  return (
    <SafeAreaView style={reportPage.container} edges={['top']}>
      <ScrollView contentContainerStyle={reportPage.content} testID="course-history-page">
        <ReportHero kicker="تدقيق" title={`سجل تغييرات: ${data?.course?.name || '…'}`} subtitle={data ? `المستوى ${data.course.level ?? '—'} · شعبة ${data.course.section || '—'} · ${data.lectures_count} محاضرة · ${data.count} حدث` : 'كل ما جرى على محاضرات المقرر وخانات جدوله: من، متى، وماذا تغيّر'} onBack={() => goBack()} canExport={false} />

        {err ? <Text style={st.err} testID="course-history-error">{err}</Text> : !data ? <ActivityIndicator color={DASH.navy} style={{ margin: 30 }} /> : (
          <>
            {badSlots.length > 0 && (
              <View style={st.alert} testID="course-history-bad-slots">
                <Ionicons name="warning-outline" size={18} color="#b91c1c" />
                <View style={{ flex: 1 }}>
                  <Text style={st.alertTitle}>خانات شاذة في الجدول الأسبوعي ({badSlots.length})</Text>
                  {badSlots.map((s: any) => <Text key={s.id} style={st.alertLine}>• {s.day} فترة {s.slot_number} — {s.issues.join('، ')} (مستوى {s.level}، شعبة «{s.section || '—'}») — أُنشئت {String(s.created_at || '').slice(0, 16)}</Text>)}
                  <Text style={st.alertLine}>هذه الخانات لا تظهر في صف المقرر بالجدول الشامل لكنها تؤثر في توليد المحاضرات ومزامنة الأوقات — احذفها من الجدول.</Text>
                </View>
              </View>
            )}

            <View style={st.filters}>
              <View style={st.search}>
                <Ionicons name="search" size={16} color="#94a3b8" />
                <TextInput value={q} onChangeText={setQ} placeholder="بحث في الأحداث (اسم المستخدم، التاريخ، الوقت…)" placeholderTextColor="#94a3b8" style={st.searchInp} testID="course-history-search" />
              </View>
              <View style={st.chips}>
                {TYPES.map(([k, l]) => <TouchableOpacity key={k} style={[st.chip, type === k && st.chipOn]} onPress={() => setType(k)} testID={`course-history-type-${k || 'all'}`}><Text style={[st.chipText, type === k && { color: '#fff' }]}>{l}</Text></TouchableOpacity>)}
              </View>
            </View>

            {events.length === 0 ? <Text style={st.empty} testID="course-history-empty">لا توجد أحداث مطابقة</Text> : events.map((e: any, i: number) => (
              <View key={i} style={st.row} testID={`course-history-event-${i}`}>
                <View style={[st.dot, { backgroundColor: TYPE_COLOR[e.type] || '#64748b' }]} />
                <View style={{ flex: 1 }}>
                  <View style={st.rowHead}>
                    <Text style={[st.action, { color: TYPE_COLOR[e.type] || '#64748b' }]}>{e.action_ar}</Text>
                    <Text style={st.when}>{String(e.at).slice(0, 16).replace('T', ' ')}</Text>
                  </View>
                  <Text style={st.summary}>{e.summary}</Text>
                  <Text style={st.by}>بواسطة: {e.by}</Text>
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  err: { color: '#b91c1c', textAlign: 'center', padding: 20, fontWeight: '700' },
  empty: { color: DASH.muted, textAlign: 'center', padding: 30 },
  alert: { flexDirection: 'row-reverse', gap: 10, backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca', borderRadius: 12, padding: 12, marginBottom: 12 },
  alertTitle: { fontSize: 13, fontWeight: '800', color: '#991b1b', textAlign: 'right' },
  alertLine: { fontSize: 11.5, color: '#7f1d1d', textAlign: 'right', marginTop: 3, lineHeight: 18 },
  filters: { backgroundColor: '#fff', borderRadius: 14, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: DASH.line, gap: 10 },
  search: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: DASH.line, borderRadius: 10, paddingHorizontal: 10, height: 42, backgroundColor: '#f8fafc' },
  searchInp: { flex: 1, fontSize: 13, textAlign: 'right', color: DASH.ink, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
  chips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: DASH.line },
  chipOn: { backgroundColor: DASH.navy, borderColor: DASH.navy },
  chipText: { fontSize: 12, fontWeight: '700', color: '#334155' },
  row: { flexDirection: 'row-reverse', gap: 10, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: DASH.line, padding: 12, marginBottom: 8 },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  rowHead: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
  action: { fontSize: 13, fontWeight: '800' },
  when: { fontSize: 11.5, color: DASH.muted },
  summary: { fontSize: 12.5, color: DASH.ink, textAlign: 'right', marginTop: 4, lineHeight: 19 },
  by: { fontSize: 11.5, color: DASH.muted, textAlign: 'right', marginTop: 3 },
});
