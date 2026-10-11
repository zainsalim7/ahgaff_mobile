import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { goBack } from '../src/utils/navigation';
import api from '../src/services/api';
import { ReportHero, reportPage } from '../src/components/reports/ReportShell';
import { DASH } from '../src/components/dashboard/dashTheme';

const STATUS: Record<string, [string, string]> = { draft: ['مسودة', '#64748b'], pending: ['قيد التوقيع', '#b45309'], approved: ['معتمد', '#1d4ed8'], issued: ['صادر', '#15803d'], revoked: ['ملغي', '#b91c1c'] };
const normAr = (s: any) => String(s || '').toLowerCase().replace(/[\u064B-\u0652]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim();

export default function OvertimeLettersRegister() {
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [openId, setOpenId] = useState('');

  const load = async () => {
    setLoading(true); setErr('');
    try { const r = await api.get('/reports/teacher-workload/letters', { params: status ? { status } : {} }); setItems(r.data.items || []); }
    catch (e: any) { setErr(e?.response?.data?.detail || 'تعذر تحميل السجل'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [status]);

  const rows = useMemo(() => {
    const nq = normAr(q);
    if (!nq) return items;
    return items.filter((it) => normAr(it.number).includes(nq) || normAr(it.subject).includes(nq) || normAr(it.scope).includes(nq) || (it.teachers_list || []).some((t: any) => normAr(t.name).includes(nq)));
  }, [items, q]);

  const totals = rows.reduce((a, it) => ({ letters: a.letters + 1, teachers: a.teachers + (it.teachers || 0), hours: a.hours + (it.overtime_hours || 0), amount: a.amount + (it.amount || 0) }), { letters: 0, teachers: 0, hours: 0, amount: 0 });

  return (
    <SafeAreaView style={reportPage.safe} edges={['top']}>
      <ScrollView contentContainerStyle={reportPage.content} testID="overtime-letters-page">
        <ReportHero kicker="التقارير · سجل خاص" title="سجل خطابات كشوف الساعات الإضافية" subtitle="كل خطاب رُفع من كشف الساعات الإضافية: الفترة، النطاق، الأساتذة، الساعات، الحالة — يظهر لمن له صلاحية تقرير النصاب فقط" onBack={() => goBack()} canExport={false}
          extra={<TouchableOpacity style={st.heroBtn} onPress={() => router.push('/report-teacher-workload' as any)} testID="ol-go-report"><Ionicons name="briefcase-outline" size={15} color="#fff" /><Text style={st.heroBtnText}>تقرير النصاب</Text></TouchableOpacity>} />

        <View style={st.filters} testID="ol-filters">
          <View style={st.search}>
            <Ionicons name="search" size={16} color="#94a3b8" />
            <TextInput value={q} onChangeText={setQ} placeholder="بحث برقم الخطاب أو اسم الأستاذ أو الكلية/القسم" placeholderTextColor="#94a3b8" style={st.searchInp} testID="ol-search" />
          </View>
          <View style={st.chips}>
            {[['', 'الكل'], ['draft', 'مسودة'], ['issued', 'صادر'], ['revoked', 'ملغي']].map(([k, l]) => (
              <TouchableOpacity key={k} style={[st.chip, status === k && st.chipOn]} onPress={() => setStatus(k)} testID={`ol-status-${k || 'all'}`}><Text style={[st.chipText, status === k && { color: '#fff' }]}>{l}</Text></TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={st.kpis}>
          {[['الخطابات', totals.letters, DASH.navy], ['الأساتذة المرفوعون', totals.teachers, '#7c3aed'], ['الساعات الإضافية', Math.round(totals.hours * 10) / 10, DASH.green], ['المستحقات', totals.amount ? totals.amount.toLocaleString('en-US') : '—', '#b45309']].map(([l, v, c]) => (
            <View key={String(l)} style={[st.kpi, { borderTopColor: c as string }]}><Text style={st.kpiLbl}>{l}</Text><Text style={[st.kpiVal, { color: c as string }]}>{v}</Text></View>
          ))}
        </View>

        {loading ? <ActivityIndicator color={DASH.navy} style={{ margin: 30 }} /> : err ? <Text style={st.err} testID="ol-error">{err}</Text> : rows.length === 0 ? (
          <View style={st.empty} testID="ol-empty"><Ionicons name="mail-open-outline" size={36} color="#cbd5e1" /><Text style={st.emptyText}>لا توجد خطابات مرفوعة{q || status ? ' مطابقة للبحث' : ' بعد'}</Text></View>
        ) : rows.map((it) => {
          const [sl, sc] = STATUS[it.status] || [it.status, '#64748b']; const open = openId === it.letter_id;
          return (
            <View key={it.letter_id} style={st.row} testID={`ol-row-${it.letter_id}`}>
              <TouchableOpacity style={st.rowMain} onPress={() => setOpenId(open ? '' : it.letter_id)} testID={`ol-row-toggle-${it.letter_id}`}>
                <View style={[st.badge, { backgroundColor: sc + '1a' }]}><Text style={[st.badgeText, { color: sc }]}>{sl}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={st.num}>{it.number}{it.mode === 'amend' ? ' · تعديلي' : ''}{it.draft_number && it.draft_number !== it.number ? `  (مسودة ${it.draft_number})` : ''}</Text>
                  <Text style={st.sub}>{it.scope} · من {it.start_date} إلى {it.end_date} · إلى: {it.recipient || '—'}</Text>
                  <Text style={st.sub}>{it.teachers} أستاذ · {it.overtime_hours ?? 0} س إضافية{it.amount ? ` · ${Number(it.amount).toLocaleString('en-US')}` : ''}{it.excluded ? ` · استُبعد ${it.excluded}` : ''} · {it.attachments} مرفق · {String(it.issued_at || it.created_at || '').slice(0, 10)}{it.created_by ? ` · ${it.created_by}` : ''}</Text>
                </View>
                <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color="#94a3b8" />
              </TouchableOpacity>
              {open && (
                <View style={st.detail} testID={`ol-detail-${it.letter_id}`}>
                  {(it.teachers_list || []).map((t: any, i: number) => (
                    <View key={t.teacher_id + i} style={st.tLine}>
                      <Text style={st.tHours}>{t.overtime_hours} س{t.amount ? ` · ${Number(t.amount).toLocaleString('en-US')}` : ''}</Text>
                      <Text style={st.tName}>{i + 1}. {t.name}{t.department_name ? ` — ${t.department_name}` : ''}{t.prev_letter ? `  (سبق رفعه ${t.prev_letter})` : ''}</Text>
                    </View>
                  ))}
                  <TouchableOpacity style={st.openBtn} onPress={() => router.push(`/letters?id=${it.letter_id}` as any)} testID={`ol-open-${it.letter_id}`}><Ionicons name="open-outline" size={14} color="#fff" /><Text style={st.openText}>فتح الخطاب في نظام الخطابات</Text></TouchableOpacity>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  heroBtn: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  heroBtnText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  filters: { backgroundColor: '#fff', borderRadius: 14, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: DASH.line, gap: 10 },
  search: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: DASH.line, borderRadius: 10, paddingHorizontal: 10, height: 42, backgroundColor: '#f8fafc' },
  searchInp: { flex: 1, fontSize: 13, textAlign: 'right', color: DASH.ink, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
  chips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: DASH.line },
  chipOn: { backgroundColor: DASH.navy, borderColor: DASH.navy },
  chipText: { fontSize: 12, fontWeight: '700', color: '#334155' },
  kpis: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  kpi: { flex: 1, minWidth: 150, backgroundColor: '#fff', borderRadius: 12, padding: 12, borderTopWidth: 3, borderWidth: 1, borderColor: DASH.line },
  kpiLbl: { fontSize: 11.5, color: DASH.muted, textAlign: 'right', fontWeight: '700' },
  kpiVal: { fontSize: 22, fontWeight: '800', textAlign: 'right', marginTop: 4 },
  row: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: DASH.line, marginBottom: 8, overflow: 'hidden' },
  rowMain: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, padding: 12 },
  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  badgeText: { fontSize: 11.5, fontWeight: '800' },
  num: { fontSize: 14, fontWeight: '800', color: DASH.ink, textAlign: 'right' },
  sub: { fontSize: 11.5, color: DASH.muted, textAlign: 'right', marginTop: 2 },
  detail: { borderTopWidth: 1, borderTopColor: '#f1f5f9', padding: 12, backgroundColor: '#f8fafc', gap: 4 },
  tLine: { flexDirection: 'row-reverse', justifyContent: 'space-between', gap: 10 },
  tName: { fontSize: 12.5, color: DASH.ink, textAlign: 'right', flex: 1 },
  tHours: { fontSize: 12, color: DASH.green, fontWeight: '800' },
  openBtn: { alignSelf: 'flex-start', flexDirection: 'row-reverse', alignItems: 'center', gap: 6, backgroundColor: DASH.blue, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, marginTop: 8 },
  openText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  err: { color: '#b91c1c', textAlign: 'center', padding: 20, fontWeight: '700' },
  empty: { alignItems: 'center', padding: 40, gap: 8 },
  emptyText: { color: DASH.muted, fontSize: 13 },
});
