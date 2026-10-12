import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, Platform, Linking, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api, { API_URL } from '../src/services/api';

const TYPES = [['sick', 'مرضي'], ['family', 'ظرف عائلي'], ['official', 'مهمة رسمية'], ['exam', 'عذر عن اختبار'], ['other', 'أخرى']] as const;
const ROUTE_LABEL: Record<string, string> = { registration: 'التسجيل', dean: 'عميد الكلية', board: 'مجلس الكلية' };
const STATUS_COLOR: Record<string, string> = { pending: '#f59e0b', approved: '#16a34a', rejected: '#dc2626', needs_info: '#7c3aed', cancelled: '#6b7280' };
const routeFor = (t: string, d: number) => (t === 'sick' ? 'registration' : t === 'exam' || d > 2 ? 'board' : 'dean');
const daysBetween = (a: string, b: string) => (a && b ? Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86400000) + 1 : 0);
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const notify = (t: string, m: string) => (Platform.OS === 'web' ? window.alert(`${t}\n${m}`) : Alert.alert(t, m));

type Picked = { uri: string; name: string; mimeType?: string; size?: number; file?: any };

const ExcuseForm: React.FC<{ courses: any[]; onDone: () => void }> = ({ courses, onDone }) => {
  const [type, setType] = useState('sick'); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [course, setCourse] = useState(''); const [desc, setDesc] = useState(''); const [files, setFiles] = useState<Picked[]>([]); const [busy, setBusy] = useState(false);
  const days = isDate(from) && isDate(to) ? daysBetween(from, to) : 0;

  const pick = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], multiple: true, copyToCacheDirectory: true });
    if (r.canceled) return;
    setFiles((prev) => [...prev, ...r.assets.map((a) => ({ uri: a.uri, name: a.name, mimeType: a.mimeType, size: a.size, file: (a as any).file }))].slice(0, 3));
  };
  const submit = async () => {
    if (!isDate(from) || !isDate(to)) { notify('تنبيه', 'أدخل التاريخين بصيغة YYYY-MM-DD'); return; }
    if (!files.length) { notify('تنبيه', 'المستند إلزامي — أرفق ملفاً واحداً على الأقل'); return; }
    const fd = new FormData();
    fd.append('from_date', from); fd.append('to_date', to); fd.append('excuse_type', type); fd.append('description', desc);
    if (course) fd.append('course_id', course);
    files.forEach((f) => fd.append('files', (Platform.OS === 'web' && f.file ? f.file : { uri: f.uri, name: f.name, type: f.mimeType || 'application/octet-stream' }) as any));
    setBusy(true);
    try { const r = await api.post('/student-excuses', fd, { headers: { 'Content-Type': 'multipart/form-data' } }); notify('تم', r.data.message); onDone(); }
    catch (e: any) { notify('خطأ', e?.response?.data?.detail || 'فشل إرسال الطلب'); } finally { setBusy(false); }
  };

  return (
    <View style={s.card} testID="excuse-form">
      <Text style={s.cardTitle}>تقديم طلب عذر غياب</Text>
      <Text style={s.lbl}>نوع العذر</Text>
      <View style={s.chips}>{TYPES.map(([k, l]) => <TouchableOpacity key={k} onPress={() => setType(k)} style={[s.chip, type === k && s.chipOn]} testID={`excuse-type-${k}`}><Text style={[s.chipTxt, type === k && s.chipTxtOn]}>{l}</Text></TouchableOpacity>)}</View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><Text style={s.lbl}>من تاريخ</Text>{Platform.OS === 'web' ? <input type="date" value={from} onChange={(e: any) => setFrom(e.target.value)} style={webInput} data-testid="excuse-from" /> : <TextInput style={s.input} placeholder="2026-10-01" value={from} onChangeText={setFrom} testID="excuse-from" />}</View>
        <View style={{ flex: 1 }}><Text style={s.lbl}>إلى تاريخ</Text>{Platform.OS === 'web' ? <input type="date" value={to} onChange={(e: any) => setTo(e.target.value)} style={webInput} data-testid="excuse-to" /> : <TextInput style={s.input} placeholder="2026-10-02" value={to} onChangeText={setTo} testID="excuse-to" />}</View>
      </View>
      <Text style={s.lbl}>المقرر (اختياري — افتراضياً كل المقررات)</Text>
      <View style={s.chips}><TouchableOpacity onPress={() => setCourse('')} style={[s.chip, !course && s.chipOn]} testID="excuse-course-all"><Text style={[s.chipTxt, !course && s.chipTxtOn]}>كل المقررات</Text></TouchableOpacity>
        {courses.map((c) => <TouchableOpacity key={c.id} onPress={() => setCourse(c.id)} style={[s.chip, course === c.id && s.chipOn]} testID={`excuse-course-${c.id}`}><Text style={[s.chipTxt, course === c.id && s.chipTxtOn]}>{c.name}</Text></TouchableOpacity>)}</View>
      <Text style={s.lbl}>الوصف</Text>
      <TextInput style={[s.input, { minHeight: 60 }]} multiline value={desc} onChangeText={setDesc} placeholder="اكتب تفاصيل العذر…" testID="excuse-desc" />
      <Text style={s.lbl}>المستندات (PDF/صور — إلزامي، حتى 3 ملفات)</Text>
      <View style={s.chips}>
        {files.map((f, i) => <View key={i} style={[s.chip, { flexDirection: 'row', gap: 6, alignItems: 'center' }]} testID={`excuse-file-${i}`}><Text style={s.chipTxt} numberOfLines={1}>{f.name}</Text><TouchableOpacity onPress={() => setFiles(files.filter((_, j) => j !== i))}><Ionicons name="close-circle" size={16} color="#dc2626" /></TouchableOpacity></View>)}
        {files.length < 3 && <TouchableOpacity onPress={pick} style={[s.chip, { borderStyle: 'dashed' }]} testID="excuse-pick-file"><Text style={s.chipTxt}>＋ إرفاق ملف</Text></TouchableOpacity>}
      </View>
      {days > 0 && <View style={s.routeBox} testID="excuse-route-preview"><Ionicons name="git-branch-outline" size={14} color="#1e3a8a" /><Text style={s.routeTxt}>المدة {days} يوم — سيُوجَّه الطلب إلى <Text style={{ fontWeight: '800' }}>{ROUTE_LABEL[routeFor(type, days)]}</Text></Text></View>}
      <TouchableOpacity onPress={submit} disabled={busy} style={[s.btn, busy && { opacity: 0.6 }]} testID="excuse-submit"><Text style={s.btnTxt}>{busy ? 'جاري الإرسال…' : 'إرسال الطلب'}</Text></TouchableOpacity>
    </View>
  );
};

const ExcuseItem: React.FC<{ it: any; token: string; onChanged: () => void }> = ({ it, token, onChanged }) => {
  const cancel = async () => { try { await api.post(`/student-excuses/${it.id}/cancel`); onChanged(); } catch (e: any) { notify('خطأ', e?.response?.data?.detail || 'تعذر الإلغاء'); } };
  const addFiles = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], multiple: true, copyToCacheDirectory: true });
    if (r.canceled) return;
    const fd = new FormData();
    r.assets.forEach((a) => fd.append('files', (Platform.OS === 'web' && (a as any).file ? (a as any).file : { uri: a.uri, name: a.name, type: a.mimeType || 'application/octet-stream' }) as any));
    try { const res = await api.post(`/student-excuses/${it.id}/attachments`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }); notify('تم', res.data.message); onChanged(); } catch (e: any) { notify('خطأ', e?.response?.data?.detail || 'فشل رفع المرفقات'); }
  };
  return (
    <View style={s.card} testID={`excuse-item-${it.id}`}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={s.ref}>{it.ref_no}</Text>
        <View style={[s.badge, { backgroundColor: STATUS_COLOR[it.status] }]}><Text style={s.badgeTxt}>{it.status_label}</Text></View>
      </View>
      <Text style={s.line}>{it.excuse_type_label} · {it.from_date} → {it.to_date} ({it.days} يوم) · {it.course_name || 'كل المقررات'}</Text>
      <Text style={s.sub}>المسار: {it.route_label} · قُدّم {String(it.created_at || '').slice(0, 10)}</Text>
      {!!it.decision_note && <Text style={[s.sub, { color: '#334155' }]}>ملاحظة القرار: {it.decision_note}</Text>}
      {it.applied && <Text style={[s.sub, { color: '#16a34a' }]}>حُوّل غيابك في {it.applied.updated + it.applied.created} محاضرة إلى «بعذر»</Text>}
      <View style={s.chips}>
        {(it.attachments || []).map((a: any) => <TouchableOpacity key={a.idx} onPress={() => Linking.openURL(`${API_URL}/api/student-excuses/${it.id}/attachments/${a.idx}?token=${encodeURIComponent(token)}`)} style={s.chip} testID={`excuse-att-${it.id}-${a.idx}`}><Text style={s.chipTxt}>📎 {a.name}</Text></TouchableOpacity>)}
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {it.status === 'needs_info' && <TouchableOpacity onPress={addFiles} style={[s.btnSm, { backgroundColor: '#7c3aed' }]} testID={`excuse-addfiles-${it.id}`}><Text style={s.btnTxt}>إضافة مرفقات</Text></TouchableOpacity>}
        {['pending', 'needs_info'].includes(it.status) && <TouchableOpacity onPress={cancel} style={[s.btnSm, { backgroundColor: '#dc2626' }]} testID={`excuse-cancel-${it.id}`}><Text style={s.btnTxt}>إلغاء الطلب</Text></TouchableOpacity>}
      </View>
    </View>
  );
};

export default function ExcusesScreen() {
  const [items, setItems] = useState<any[]>([]); const [courses, setCourses] = useState<any[]>([]); const [showForm, setShowForm] = useState(false);
  const [token, setToken] = useState(''); const [refreshing, setRefreshing] = useState(false); const [err, setErr] = useState('');
  const load = useCallback(async () => {
    try { const r = await api.get('/student-excuses/my'); setItems(r.data.items || []); setCourses(r.data.courses || []); setErr(''); }
    catch (e: any) { setErr(e?.response?.data?.detail || 'تعذر تحميل الطلبات'); } finally { setRefreshing(false); }
  }, []);
  useEffect(() => { load(); AsyncStorage.getItem('token').then((t) => setToken(t || '')); }, [load]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f3f4f6' }} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />} testID="excuses-screen">
        <View style={s.rule}><Ionicons name="information-circle" size={16} color="#1e3a8a" /><Text style={s.ruleTxt}>العذر يُقدَّم بوثيقة ويُوجَّه تلقائياً: مرضي → التسجيل · غير مرضي حتى يومين → العميد · أكثر من يومين أو عذر عن اختبار → مجلس الكلية. عند الاعتماد يتحول غيابك ضمن الفترة إلى «بعذر».</Text></View>
        {!showForm && <TouchableOpacity onPress={() => setShowForm(true)} style={s.btn} testID="excuse-new-btn"><Text style={s.btnTxt}>＋ طلب عذر جديد</Text></TouchableOpacity>}
        {showForm && <ExcuseForm courses={courses} onDone={() => { setShowForm(false); load(); }} />}
        {showForm && <TouchableOpacity onPress={() => setShowForm(false)} style={{ alignSelf: 'center', marginBottom: 10 }} testID="excuse-form-close"><Text style={{ color: '#64748b', fontWeight: '700' }}>إغلاق النموذج</Text></TouchableOpacity>}
        {!!err && <Text style={{ color: '#dc2626', textAlign: 'center', marginVertical: 8 }} testID="excuses-error">{err}</Text>}
        <Text style={s.section}>طلباتي ({items.length})</Text>
        {items.length === 0 && !err && <Text style={{ color: '#94a3b8', textAlign: 'center', marginTop: 16 }} testID="excuses-empty">لا توجد طلبات بعد</Text>}
        {items.map((it) => <ExcuseItem key={it.id} it={it} token={token} onChanged={load} />)}
      </ScrollView>
    </SafeAreaView>
  );
}

const webInput: any = { width: '100%', border: '1px solid #d1d5db', borderRadius: 10, padding: 10, fontSize: 13, backgroundColor: '#f9fafb', boxSizing: 'border-box' };
const s = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#e5e7eb' },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#0f2440', textAlign: 'right', marginBottom: 8 },
  lbl: { fontSize: 12, fontWeight: '700', color: '#334155', textAlign: 'right', marginTop: 8, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, padding: 10, fontSize: 13, textAlign: 'right', backgroundColor: '#f9fafb' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end', marginVertical: 4 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#f8fafc', maxWidth: '100%' },
  chipOn: { backgroundColor: '#0f2440', borderColor: '#0f2440' }, chipTxt: { fontSize: 12, color: '#0f2440', fontWeight: '700' }, chipTxtOn: { color: '#fff' },
  routeBox: { flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: '#eff6ff', borderRadius: 10, padding: 10, marginTop: 8, justifyContent: 'flex-end' },
  routeTxt: { fontSize: 12.5, color: '#1e3a8a', textAlign: 'right' },
  btn: { backgroundColor: '#0f2440', borderRadius: 12, padding: 13, alignItems: 'center', marginTop: 10, marginBottom: 12 },
  btnSm: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginTop: 8 },
  btnTxt: { color: '#fff', fontWeight: '800', fontSize: 13 },
  rule: { flexDirection: 'row', gap: 8, backgroundColor: '#dbeafe', borderRadius: 12, padding: 12, marginBottom: 12, alignItems: 'flex-start' },
  ruleTxt: { flex: 1, fontSize: 12, color: '#1e3a8a', textAlign: 'right', lineHeight: 18 },
  section: { fontSize: 15, fontWeight: '800', color: '#0f2440', textAlign: 'right', marginVertical: 8 },
  ref: { fontWeight: '800', color: '#0f2440', fontSize: 13 },
  badge: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 }, badgeTxt: { color: '#fff', fontSize: 11.5, fontWeight: '800' },
  line: { fontSize: 13, color: '#1e293b', textAlign: 'right', marginTop: 6, fontWeight: '600' },
  sub: { fontSize: 11.5, color: '#64748b', textAlign: 'right', marginTop: 4 },
});
