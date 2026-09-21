import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { DASH, NUM_FONT, dashStyles } from './dashTheme';

interface TRow { teacher_id: string; name: string; courses: number; scheduled: number; completed: number; cancelled: number; absent: number; upcoming: number; commitment: number | null; avg_delay: number; late_count: number; hours: number }
export interface TeachersStats { count: number; total_hours: number; avg_commitment: number | null; avg_delay: number; top: TRow[]; bottom: TRow[]; rows: TRow[] }

const Mini = ({ label, value, color }: { label: string; value: string | number; color: string }) => (
  <View style={[styles.mini, { borderColor: color + '55' }]}>
    <Text style={[styles.miniVal, NUM_FONT, { color }]}>{value}</Text>
    <Text style={styles.miniLbl}>{label}</Text>
  </View>
);

const commitColor = (c: number | null) => (c === null ? DASH.muted : c >= 90 ? DASH.green : c >= 75 ? DASH.orange : DASH.red);

export const DashTeachers = ({ t, periodLabel }: { t: TeachersStats; periodLabel: string }) => {
  const router = useRouter();
  const [showAll, setShowAll] = useState(false);
  const rows = showAll ? t.rows : t.rows.slice(0, 6);
  return (
    <View style={[dashStyles.card, { marginBottom: 16 }]} testID="dash-teachers">
      <View style={dashStyles.sectionHead}>
        <View style={dashStyles.sectionTitleRow}>
          <View style={[dashStyles.iconBox, { backgroundColor: '#ccfbf1' }]}><Ionicons name="school" size={17} color={DASH.teal} /></View>
          <View>
            <Text style={dashStyles.sectionTitle}>إحصائيات الأساتذة — {periodLabel}</Text>
            <Text style={dashStyles.sectionSub}>الالتزام = المنفَّذة ÷ (المنفَّذة + الملغاة + غياب الأستاذ)</Text>
          </View>
        </View>
        <TouchableOpacity style={dashStyles.linkBtn} onPress={() => router.push('/report-teacher-workload' as any)} testID="dash-teachers-route">
          <Text style={dashStyles.linkText}>نصاب المدرسين</Text><Ionicons name="arrow-back" size={12} color={DASH.blue} />
        </TouchableOpacity>
      </View>
      <View style={styles.minis}>
        <Mini label="أساتذة لهم محاضرات" value={t.count} color={DASH.teal} />
        <Mini label="متوسط الالتزام" value={t.avg_commitment === null ? '—' : `${t.avg_commitment}%`} color={commitColor(t.avg_commitment)} />
        <Mini label="متوسط التأخير (د)" value={t.avg_delay} color={t.avg_delay >= 15 ? DASH.red : DASH.orange} />
        <Mini label="ساعات منفَّذة" value={t.total_hours} color={DASH.navy2} />
      </View>
      {t.rows.length === 0 ? (
        <View style={dashStyles.empty}><Text style={dashStyles.emptyText}>لا توجد محاضرات لأساتذة في هذه الفترة</Text></View>
      ) : (
        <>
          <View style={[styles.tr, styles.th]}>
            <Text style={[styles.td, styles.name, styles.thText]}>الأستاذ</Text>
            {['مقررات', 'مجدولة', 'منفَّذة', 'ملغاة', 'غياب', 'تأخر', 'ساعات', 'الالتزام'].map((h) => <Text key={h} style={[styles.td, styles.thText]}>{h}</Text>)}
          </View>
          {rows.map((r) => (
            <View key={r.teacher_id} style={styles.tr} testID={`dash-teacher-row-${r.teacher_id}`}>
              <Text style={[styles.td, styles.name]} numberOfLines={1}>{r.name}</Text>
              {[r.courses, r.scheduled, r.completed, r.cancelled, r.absent, r.late_count, r.hours].map((v, i) => <Text key={i} style={[styles.td, NUM_FONT]}>{v}</Text>)}
              <View style={styles.td}>
                <View style={[styles.pill, { backgroundColor: commitColor(r.commitment) + '1a' }]}>
                  <Text style={[styles.pillText, NUM_FONT, { color: commitColor(r.commitment) }]}>{r.commitment === null ? '—' : `${r.commitment}%`}</Text>
                </View>
              </View>
            </View>
          ))}
          {t.rows.length > 6 && (
            <TouchableOpacity style={styles.more} onPress={() => setShowAll(!showAll)} testID="dash-teachers-toggle">
              <Text style={dashStyles.linkText}>{showAll ? 'عرض أقل' : `عرض الكل (${t.rows.length})`}</Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  minis: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  mini: { flexGrow: 1, flexBasis: 140, borderWidth: 1, borderRadius: 12, padding: 10, backgroundColor: '#fafbfd' },
  miniVal: { fontSize: 20, fontWeight: '800', textAlign: 'right' },
  miniLbl: { fontSize: 11, color: DASH.muted, textAlign: 'right', marginTop: 2 },
  tr: { flexDirection: 'row-reverse', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  th: { backgroundColor: '#f8fafc', borderRadius: 8 },
  td: { flex: 1, fontSize: 12, color: '#334155', textAlign: 'center' },
  thText: { fontWeight: '800', color: DASH.muted, fontSize: 11 },
  name: { flex: 2.4, textAlign: 'right', fontWeight: '700', color: DASH.ink, paddingRight: 8 },
  pill: { alignSelf: 'center', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  pillText: { fontSize: 11.5, fontWeight: '800' },
  more: { alignItems: 'center', paddingTop: 10 },
});
