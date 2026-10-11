import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView, TextInput, ActivityIndicator, Platform, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from '../../services/api';
import { DASH } from '../dashboard/dashTheme';

const notify = (m: string) => (Platform.OS === 'web' ? window.alert(m) : Alert.alert('', m));
const STATUS_AR: Record<string, string> = { draft: 'مسودة', issued: 'صادر', revoked: 'ملغي', pending: 'قيد التوقيع', approved: 'معتمد' };

/** 🔖 شارة الخطابات المرفوعة لهذه الفترة + زر «رفع كخطاب» */
export const RaiseLetterBar: React.FC<{ params: any; disabled?: boolean; raised?: any[]; onDone?: () => void }> = ({ params, disabled, raised = [], onDone }) => {
  const router = useRouter();
  const [status, setStatus] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const load = async () => {
    try { const r = await api.get('/reports/teacher-workload/letter-status', { params: { start_date: params.start_date, end_date: params.end_date, faculty_id: params.faculty_id, department_id: params.department_id, teacher_id: params.teacher_id } }); setStatus(r.data); }
    catch { setStatus(null); }
  };
  useEffect(() => { load(); }, [params.start_date, params.end_date, params.faculty_id, params.department_id, params.teacher_id]);
  return (
    <View style={st.bar} testID="raise-letter-bar">
      <TouchableOpacity style={[st.btn, disabled && { opacity: 0.5 }]} onPress={() => setOpen(true)} disabled={disabled} testID="raise-letter-btn">
        <Ionicons name="mail-outline" size={16} color="#fff" /><Text style={st.btnText}>رفع كخطاب رسمي</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[st.btn, { backgroundColor: '#475569' }]} onPress={() => router.push('/overtime-letters' as any)} testID="raise-letter-register-btn">
        <Ionicons name="albums-outline" size={15} color="#fff" /><Text style={st.btnText}>سجل الخطابات</Text>
      </TouchableOpacity>
      {raised.length > 0 && <View style={[st.badge, { backgroundColor: '#fef3c7' }]} testID="raise-letter-raised-count"><Ionicons name="alert-circle-outline" size={13} color="#b45309" /><Text style={[st.badgeText, { color: '#92400e' }]}>{raised.length} أستاذاً سبق رفعهم عن فترة متداخلة</Text></View>}
      {status?.items?.map((it: any) => (
        <TouchableOpacity key={it.letter_id} style={[st.badge, it.status === 'revoked' && { backgroundColor: '#f1f5f9' }]} onPress={() => router.push(`/letters?id=${it.letter_id}` as any)} testID={`raise-letter-badge-${it.letter_id}`}>
          <Ionicons name="document-text-outline" size={13} color={DASH.navy} />
          <Text style={st.badgeText}>{it.mode === 'amend' ? 'تعديلي ' : ''}رُفع بالخطاب {it.number} · {String(it.issued_at || it.created_at).slice(0, 10)} · {STATUS_AR[it.status] || it.status}</Text>
        </TouchableOpacity>
      ))}
      <RaiseLetterModal visible={open} onClose={() => setOpen(false)} params={params} hasActive={!!status?.has_active} raised={raised} onDone={() => { load(); onDone?.(); }} />
    </View>
  );
};

const RaiseLetterModal: React.FC<{ visible: boolean; onClose: () => void; params: any; hasActive: boolean; raised: any[]; onDone: () => void }> = ({ visible, onClose, params, hasActive, raised, onDone }) => {
  const router = useRouter();
  const [dupMode, setDupMode] = useState<'exclude' | 'tag'>('exclude');
  const [keep, setKeep] = useState<Record<string, boolean>>({});  // أساتذة مكررون اختار المستخدم إبقاءهم رغم ذلك
  const [tpls, setTpls] = useState<any[]>([]);
  const [recs, setRecs] = useState<any[]>([]);
  const [tpl, setTpl] = useState('');
  const [recId, setRecId] = useState('');
  const [manual, setManual] = useState({ name: '', title: '' });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    if (!visible) return;
    setLoading(true); setResult(null);
    Promise.all([api.get('/reports/teacher-workload/letter-templates'), api.get('/letters/recipients')])
      .then(([t, r]) => { setTpls(t.data.templates || []); setRecs(r.data || []); if (!tpl && t.data.templates?.[0]) setTpl(t.data.templates[0].key); })
      .catch((e) => notify(e?.response?.data?.detail || 'فشل التحميل'))
      .finally(() => setLoading(false));
  }, [visible]);

  const chosenTpl = tpls.find((t) => t.key === tpl);
  const suggested = recs.filter((r) => chosenTpl && (r.title || '').includes((chosenTpl.recipient_title || '').split(' ').slice(0, 2).join(' ')));
  const submit = async () => {
    const rec = recId ? recs.find((r) => r.id === recId) : null;
    const recipient = rec ? { id: rec.id, name: rec.name, title: rec.title, organization: rec.organization, suffix: rec.suffix } : { name: manual.name.trim(), title: manual.title.trim() || chosenTpl?.recipient_title || '', suffix: 'المحترم' };
    if (!recipient.name && !recipient.title) { notify('حدد الجهة المرسل إليها'); return; }
    setBusy(true);
    try {
      const exclude_teacher_ids = dupMode === 'exclude' ? raised.filter((r) => !keep[r.teacher_id]).map((r) => r.teacher_id) : [];
      const r = await api.post('/reports/teacher-workload/raise-letter', { template_key: tpl, start_date: params.start_date, end_date: params.end_date, faculty_id: params.faculty_id, department_id: params.department_id, teacher_id: params.teacher_id, hide_empty: !!params.hide_empty, only_overtime: !!params.only_overtime, recipient, extra_note: note, mode: hasActive ? 'amend' : 'new', base_url: Platform.OS === 'web' ? window.location.origin : '', exclude_teacher_ids, tag_previous: dupMode === 'tag' || Object.values(keep).some(Boolean) });
      setResult(r.data); onDone();
    } catch (e: any) { notify(e?.response?.data?.detail || 'فشل إنشاء الخطاب'); } finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={st.backdrop}>
        <View style={st.card} testID="raise-letter-modal">
          <View style={st.head}>
            <Text style={st.title}>✉️ رفع كشف الساعات الإضافية كخطاب رسمي</Text>
            <TouchableOpacity onPress={onClose} testID="raise-letter-close"><Ionicons name="close" size={20} color={DASH.muted} /></TouchableOpacity>
          </View>
          {loading ? <ActivityIndicator color={DASH.navy} style={{ margin: 30 }} /> : result ? (
            <View testID="raise-letter-result">
              <Text style={st.ok}>✅ {result.message}</Text>
              <Text style={st.hint}>المرفقات: {result.attachments?.map((a: any) => a.filename).join(' · ')}</Text>
              <View style={st.actions}>
                <TouchableOpacity style={[st.btn, { backgroundColor: DASH.blue }]} onPress={() => { onClose(); router.push(`/letters?id=${result.letter_id}` as any); }} testID="raise-letter-open"><Text style={st.btnText}>فتح المسودة في نظام الخطابات</Text></TouchableOpacity>
                <TouchableOpacity style={[st.btn, { backgroundColor: '#64748b' }]} onPress={onClose}><Text style={st.btnText}>إغلاق</Text></TouchableOpacity>
              </View>
            </View>
          ) : (
            <ScrollView style={{ maxHeight: 520 }}>
              {hasActive && <Text style={st.warn}>⚠️ هذه الفترة مرفوعة مسبقاً — سيُنشأ خطاب <Text style={{ fontWeight: '800' }}>تعديلي/إلحاقي</Text></Text>}
              {raised.length > 0 && (
                <View style={st.dupBox} testID="raise-dup-box">
                  <Text style={st.dupTitle}>⚠️ {raised.length} أستاذاً سبق رفعهم في خطاب غير ملغى عن فترة متداخلة:</Text>
                  {raised.map((r) => (
                    <View key={r.teacher_id} style={st.dupLine} testID={`raise-dup-${r.teacher_id}`}>
                      {dupMode === 'exclude' && <TouchableOpacity onPress={() => setKeep({ ...keep, [r.teacher_id]: !keep[r.teacher_id] })} testID={`raise-dup-keep-${r.teacher_id}`}><Ionicons name={keep[r.teacher_id] ? 'checkbox' : 'square-outline'} size={18} color={keep[r.teacher_id] ? DASH.blue : '#94a3b8'} /></TouchableOpacity>}
                      <Text style={st.dupText}>{r.teacher_name} — {r.letters.map((l: any) => `${l.number} (${l.start_date} → ${l.end_date}${l.same_period ? '، نفس الفترة' : ''}، ${STATUS_AR[l.status] || l.status})`).join('؛ ')}</Text>
                    </View>
                  ))}
                  <View style={st.chips}>
                    <TouchableOpacity style={[st.chip, dupMode === 'exclude' && st.chipOn]} onPress={() => setDupMode('exclude')} testID="raise-dup-exclude"><Text style={[st.chipText, dupMode === 'exclude' && { color: '#fff' }]}>استبعادهم من الخطاب{dupMode === 'exclude' ? ' (علّم من تريد إبقاءه بوسم)' : ''}</Text></TouchableOpacity>
                    <TouchableOpacity style={[st.chip, dupMode === 'tag' && st.chipOn]} onPress={() => setDupMode('tag')} testID="raise-dup-tag"><Text style={[st.chipText, dupMode === 'tag' && { color: '#fff' }]}>إدراج الجميع بوسم «سبق رفعه»</Text></TouchableOpacity>
                  </View>
                </View>
              )}
              <Text style={st.lbl}>نوع الخطاب / الجهة</Text>
              {tpls.map((t) => (
                <TouchableOpacity key={t.key} style={[st.opt, tpl === t.key && st.optOn]} onPress={() => { setTpl(t.key); setRecId(''); }} testID={`raise-tpl-${t.key}`}>
                  <Text style={[st.optText, tpl === t.key && { color: '#fff' }]}>{t.name}</Text>
                </TouchableOpacity>
              ))}
              <Text style={st.lbl}>المرسَل إليه</Text>
              <View style={st.chips}>
                {(suggested.length ? suggested : recs).slice(0, 12).map((r) => (
                  <TouchableOpacity key={r.id} style={[st.chip, recId === r.id && st.chipOn]} onPress={() => setRecId(recId === r.id ? '' : r.id)} testID={`raise-rec-${r.id}`}>
                    <Text style={[st.chipText, recId === r.id && { color: '#fff' }]}>{r.title}{r.name ? ` — ${r.name}` : ''}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {!recId && (
                <View style={{ gap: 6 }}>
                  <TextInput value={manual.title} onChangeText={(v) => setManual({ ...manual, title: v })} placeholder={chosenTpl?.recipient_title || 'الصفة'} style={st.inp} testID="raise-rec-title" />
                  <TextInput value={manual.name} onChangeText={(v) => setManual({ ...manual, name: v })} placeholder="اسم المرسل إليه (اختياري)" style={st.inp} testID="raise-rec-name" />
                </View>
              )}
              <Text style={st.lbl}>ملاحظة إضافية في المتن (اختياري)</Text>
              <TextInput value={note} onChangeText={setNote} multiline style={[st.inp, { minHeight: 60 }]} testID="raise-note" />
              <Text style={st.hint}>سيُنشأ الخطاب كمسودة بجدول ملخص (سطر لكل أستاذ) ومرفقين: PDF الكشف التفصيلي وExcel المستحقات، ثم يمر بمسار المراجعة والتوقيع والإصدار في نظام الخطابات.</Text>
              <View style={st.actions}>
                <TouchableOpacity style={[st.btn, { backgroundColor: DASH.green }]} onPress={submit} disabled={busy} testID="raise-letter-submit"><Text style={st.btnText}>{busy ? '...' : hasActive ? 'إنشاء خطاب تعديلي' : 'إنشاء مسودة الخطاب'}</Text></TouchableOpacity>
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
};

const st = StyleSheet.create({
  bar: { flexDirection: 'row-reverse', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  btn: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, backgroundColor: DASH.navy, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 12.5 },
  badge: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, backgroundColor: '#e0f2fe', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  badgeText: { fontSize: 11.5, color: DASH.navy, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, width: '100%', maxWidth: 600 },
  head: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  title: { fontSize: 15, fontWeight: '800', color: DASH.ink },
  lbl: { fontSize: 12.5, fontWeight: '700', color: DASH.ink, textAlign: 'right', marginTop: 10, marginBottom: 6 },
  hint: { fontSize: 11, color: DASH.muted, textAlign: 'right', marginTop: 8, lineHeight: 17 },
  warn: { fontSize: 12, color: '#b45309', backgroundColor: '#fff7ed', padding: 8, borderRadius: 8, textAlign: 'right' },
  dupBox: { backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fcd34d', borderRadius: 10, padding: 10, marginTop: 8, gap: 6 },
  dupTitle: { fontSize: 12.5, fontWeight: '800', color: '#92400e', textAlign: 'right' },
  dupLine: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  dupText: { flex: 1, fontSize: 11.5, color: '#78350f', textAlign: 'right', lineHeight: 17 },
  ok: { fontSize: 13, color: DASH.green, fontWeight: '700', textAlign: 'right', lineHeight: 20 },
  opt: { padding: 10, borderRadius: 10, backgroundColor: '#f1f5f9', marginBottom: 6 },
  optOn: { backgroundColor: DASH.navy },
  optText: { fontSize: 12.5, fontWeight: '700', color: '#334155', textAlign: 'right' },
  chips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: DASH.line },
  chipOn: { backgroundColor: DASH.blue, borderColor: DASH.blue },
  chipText: { fontSize: 11.5, fontWeight: '700', color: '#334155' },
  inp: { borderWidth: 1, borderColor: DASH.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, textAlign: 'right' },
  actions: { flexDirection: 'row-reverse', gap: 8, marginTop: 14 },
});
