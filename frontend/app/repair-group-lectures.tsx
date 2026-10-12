import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api from '../src/services/api';

const alertMsg = (t: string, m: string) => (Platform.OS === 'web' ? window.alert(`${t}\n\n${m}`) : Alert.alert(t, m));
const confirmMsg = (m: string) => (Platform.OS === 'web' ? Promise.resolve(window.confirm(m)) : new Promise<boolean>((r) => Alert.alert('تأكيد', m, [{ text: 'إلغاء', onPress: () => r(false) }, { text: 'متابعة', onPress: () => r(true) }])));

/** 🩹 استعادة محاضرات المجموعات التي أُلغيت خطأً كـ«مكررة» */
export default function RepairGroupLecturesScreen() {
  const [includePast, setIncludePast] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<any>(null);

  const run = async (dryRun: boolean) => {
    if (!dryRun && !(await confirmMsg(`سيتم استعادة ${preview?.restored || 0} محاضرة إلى «مجدولة». متابعة؟`))) return;
    setBusy(true);
    try {
      const r = await api.post(`/admin/lectures/repair-group-duplicates?include_past=${includePast}&dry_run=${dryRun}`);
      if (dryRun) { setPreview(r.data); setDone(null); } else { setDone(r.data); setPreview(null); alertMsg('تم', `استُعيدت ${r.data.restored} محاضرة`); }
    } catch (e: any) { alertMsg('خطأ', e?.response?.data?.detail || 'فشل التنفيذ'); } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} testID="repair-group-lectures-screen">
        <View style={s.info}>
          <Ionicons name="information-circle" size={18} color="#1e3a8a" />
          <Text style={s.infoTxt}>كان تنظيف «المحاضرات المكررة» يعتبر محاضرات مجموعتين في نفس الوقت تكراراً ويلغي إحداها تلقائياً. هذه الأداة تستعيد المحاضرات المُلغاة بهذا السبب إلى «مجدولة» إن لم توجد محاضرة نشطة أخرى لنفس المجموعة في نفس الوقت.{'\n'}افتراضياً تُعالَج المحاضرات القادمة فقط؛ المحاضرات الماضية تتحول بعد الاستعادة إلى «غياب أستاذ» تلقائياً إن لم يُسجَّل لها حضور — لذا فعّلها بوعي.</Text>
        </View>
        <TouchableOpacity onPress={() => { setIncludePast(!includePast); setPreview(null); }} style={s.toggle} testID="repair-include-past">
          <Ionicons name={includePast ? 'checkbox' : 'square-outline'} size={22} color="#0f2440" />
          <Text style={s.toggleTxt}>تضمين المحاضرات الماضية أيضاً</Text>
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity onPress={() => run(true)} disabled={busy} style={[s.btn, { backgroundColor: '#1565c0' }]} testID="repair-preview-btn"><Text style={s.btnTxt}>معاينة (بدون تغيير)</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => run(false)} disabled={busy || !preview?.restored} style={[s.btn, { backgroundColor: '#16a34a', opacity: busy || !preview?.restored ? 0.5 : 1 }]} testID="repair-execute-btn"><Text style={s.btnTxt}>تنفيذ الاستعادة</Text></TouchableOpacity>
        </View>
        {busy && <ActivityIndicator style={{ marginTop: 16 }} color="#0f2440" />}
        {preview && (
          <View style={s.card} testID="repair-preview">
            <Text style={s.kpi}>سيُستعاد: <Text style={{ color: '#16a34a' }}>{preview.restored}</Text> · تكرار حقيقي يبقى ملغى: <Text style={{ color: '#64748b' }}>{preview.kept_real_duplicates}</Text></Text>
            {(preview.items || []).length === 0 && <Text style={s.empty}>لا توجد محاضرات مُلغاة خطأً ضمن النطاق المحدد ✅</Text>}
            {(preview.items || []).map((it: any) => (
              <View key={it.id} style={s.row} testID={`repair-item-${it.id}`}>
                <Text style={s.rowTxt}>{it.date} · {it.start_time}</Text>
                <Text style={[s.rowTxt, { color: '#7c3aed', fontWeight: '800' }]}>مجموعة {it.group}</Text>
                <Text style={[s.rowTxt, { color: '#64748b', fontSize: 11 }]}>{it.course_id}</Text>
              </View>
            ))}
          </View>
        )}
        {done && <View style={[s.card, { borderColor: '#16a34a' }]} testID="repair-done"><Text style={s.kpi}>✅ استُعيدت {done.restored} محاضرة{done.include_past ? ' (شمل الماضية)' : ''}</Text></View>}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  info: { flexDirection: 'row', gap: 8, backgroundColor: '#dbeafe', borderRadius: 12, padding: 12, marginBottom: 14, alignItems: 'flex-start' },
  infoTxt: { flex: 1, color: '#1e3a8a', fontSize: 12.5, lineHeight: 19, textAlign: 'right' },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, justifyContent: 'flex-end' },
  toggleTxt: { fontSize: 14, fontWeight: '700', color: '#0f2440' },
  btn: { flex: 1, borderRadius: 10, padding: 12, alignItems: 'center' },
  btnTxt: { color: '#fff', fontWeight: '800', fontSize: 13 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginTop: 14, borderWidth: 1, borderColor: '#e2e8f0' },
  kpi: { fontSize: 14, fontWeight: '800', color: '#0f2440', textAlign: 'right', marginBottom: 8 },
  empty: { color: '#16a34a', textAlign: 'center', fontWeight: '700', marginTop: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  rowTxt: { fontSize: 12.5, color: '#1e293b' },
});
