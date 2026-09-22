import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import api from '../src/services/api';
import { DASH, NUM_FONT, dashStyles } from '../src/components/dashboard/dashTheme';

interface Digest { id: string; week_start: string; week_end: string; scope_label: string; filename: string; trigger: string; recipients: number; summary: { students: number; lectures: number; completed: number; cancelled: number; attendance_rate: number | null; alerts: number; pending_fees: number | null } }

export default function DashboardDigestsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Digest[]>([]);
  const [schedule, setSchedule] = useState<any>(null);
  const [canSend, setCanSend] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [downloading, setDownloading] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/dashboard/digests');
      setItems(r.data.digests); setSchedule(r.data.schedule); setCanSend(r.data.can_send_now);
    } catch (e: any) {
      setMsg(e?.response?.data?.detail || 'تعذر تحميل الملخصات');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const sendNow = async () => {
    setSending(true); setMsg('');
    try {
      const r = await api.post('/dashboard/digests/send-now');
      setMsg(`✅ تم توليد ${r.data.scopes.length} ملخص وإرسال ${r.data.pushes} إشعار`);
      load();
    } catch (e: any) {
      setMsg(e?.response?.data?.detail || 'فشل الإرسال');
    } finally { setSending(false); }
  };

  const open = async (d: Digest) => {
    setDownloading(d.id);
    try {
      const res = await api.get(`/dashboard/digests/${d.id}/file`, { responseType: 'blob' });
      if (Platform.OS === 'web') {
        const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
        const a = document.createElement('a'); a.href = url; a.download = d.filename; a.click();
        window.URL.revokeObjectURL(url);
      } else {
        const path = `${FileSystem.documentDirectory}${d.filename}`;
        const reader = new FileReader();
        reader.onloadend = async () => {
          await FileSystem.writeAsStringAsync(path, (reader.result as string).split(',')[1], { encoding: FileSystem.EncodingType.Base64 });
          await Sharing.shareAsync(path);
        };
        reader.readAsDataURL(new Blob([res.data]));
      }
    } catch { Alert.alert('خطأ', 'تعذر تحميل الملف'); } finally { setDownloading(''); }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} testID="dashboard-digests-screen">
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>الملخصات الأسبوعية</Text>
            {schedule && <Text style={styles.sub}>يُرسل تلقائياً كل {schedule.weekday} {schedule.hour} (توقيت اليمن) — {schedule.period}{schedule.last_run ? ` · آخر إرسال ${schedule.last_run.slice(0, 16).replace('T', ' ')}` : ''}</Text>}
          </View>
          <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="digests-back-btn"><Ionicons name="arrow-forward" size={20} color={DASH.navy} /></TouchableOpacity>
        </View>
        {canSend && (
          <TouchableOpacity style={styles.sendBtn} onPress={sendNow} disabled={sending} testID="digests-send-now-btn">
            {sending ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="paper-plane" size={16} color="#fff" />}
            <Text style={styles.sendText}>{sending ? 'جارٍ التوليد والإرسال…' : 'إرسال الملخص الآن (لكل المستلمين)'}</Text>
          </TouchableOpacity>
        )}
        {!!msg && <Text style={styles.msg} testID="digests-msg">{msg}</Text>}
        {loading ? <ActivityIndicator color={DASH.navy} style={{ marginTop: 30 }} /> : items.length === 0 ? (
          <View style={dashStyles.empty}><Ionicons name="mail-open-outline" size={40} color="#cbd5e1" /><Text style={dashStyles.emptyText}>لا توجد ملخصات بعد — سيصل أول ملخص صباح السبت</Text></View>
        ) : items.map((d) => (
          <View key={d.id} style={[dashStyles.card, styles.item]} testID={`digest-${d.id}`}>
            <View style={styles.itemHead}>
              <TouchableOpacity style={styles.dl} onPress={() => open(d)} disabled={downloading === d.id} testID={`digest-open-${d.id}`}>
                {downloading === d.id ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="document-text" size={15} color="#fff" />}
                <Text style={styles.dlText}>PDF</Text>
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Text style={styles.scope}>{d.scope_label}</Text>
                <Text style={[styles.week, NUM_FONT]}>{d.week_start} ← {d.week_end}{d.trigger === 'manual' ? ' · يدوي' : ''}</Text>
              </View>
            </View>
            <View style={styles.stats}>
              {[
                ['الحضور', d.summary.attendance_rate === null ? '—' : `${d.summary.attendance_rate}%`],
                ['منفَّذة', `${d.summary.completed}/${d.summary.lectures}`],
                ['ملغاة', d.summary.cancelled],
                ['تنبيهات', d.summary.alerts],
                ['طلاب', d.summary.students],
              ].map(([l, v]) => (
                <View key={String(l)} style={styles.stat}><Text style={[styles.statVal, NUM_FONT]}>{v as any}</Text><Text style={styles.statLbl}>{l}</Text></View>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: DASH.bg },
  content: { padding: 16, maxWidth: 900, width: '100%', alignSelf: 'center', paddingBottom: 40 },
  head: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, marginBottom: 14 },
  back: { width: 38, height: 38, borderRadius: 10, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DASH.line },
  title: { fontSize: 20, fontWeight: '800', color: DASH.ink, textAlign: 'right' },
  sub: { fontSize: 12, color: DASH.muted, textAlign: 'right', marginTop: 3 },
  sendBtn: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: DASH.navy, padding: 12, borderRadius: 12, marginBottom: 12 },
  sendText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  msg: { textAlign: 'right', color: DASH.navy2, fontSize: 12.5, marginBottom: 10, fontWeight: '700' },
  item: { marginBottom: 12 },
  itemHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  scope: { fontSize: 15, fontWeight: '800', color: DASH.ink, textAlign: 'right' },
  week: { fontSize: 11.5, color: DASH.muted, textAlign: 'right', marginTop: 2 },
  dl: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, backgroundColor: '#b91c1c', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  dlText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  stats: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  stat: { flexGrow: 1, flexBasis: 90, backgroundColor: '#f8fafc', borderRadius: 10, padding: 8, alignItems: 'center' },
  statVal: { fontSize: 15, fontWeight: '800', color: DASH.navy },
  statLbl: { fontSize: 10.5, color: DASH.muted, marginTop: 1 },
});
