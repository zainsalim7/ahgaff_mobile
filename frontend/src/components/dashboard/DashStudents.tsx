import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { DASH, NUM_FONT, dashStyles } from './dashTheme';

export interface StudentsStats {
  by_department: { department_id: string; name: string; students: number; rate: number | null }[];
  by_level: { level: string; students: number }[];
  by_status: { status: string; label: string; count: number }[];
  warned: number; deprived: number; evaluated: number;
}

const STATUS_COLORS: Record<string, string> = { active: DASH.green, graduated: DASH.blue, suspended: DASH.orange, frozen: DASH.orange, repeat: DASH.purple, repeater: DASH.purple, dismissed: DASH.red, expelled: DASH.red };
const rateColor = (r: number | null) => (r === null ? '#cbd5e1' : r >= 75 ? DASH.green : r >= 60 ? DASH.orange : DASH.red);

export const DashStudents = ({ s, periodLabel }: { s: StudentsStats; periodLabel: string }) => {
  const router = useRouter();
  const maxDept = Math.max(1, ...s.by_department.map((d) => d.students));
  const maxLvl = Math.max(1, ...s.by_level.map((l) => l.students));
  const totalStatus = s.by_status.reduce((a, b) => a + b.count, 0) || 1;
  return (
    <View style={[dashStyles.card, { marginBottom: 16 }]} testID="dash-students">
      <View style={dashStyles.sectionHead}>
        <View style={dashStyles.sectionTitleRow}>
          <View style={[dashStyles.iconBox, { backgroundColor: '#dbeafe' }]}><Ionicons name="people" size={17} color={DASH.blue} /></View>
          <View>
            <Text style={dashStyles.sectionTitle}>إحصائيات الطلاب</Text>
            <Text style={dashStyles.sectionSub}>التوزيع والحضور حسب القسم والمستوى · الحالات · الإنذارات ({periodLabel})</Text>
          </View>
        </View>
        <TouchableOpacity style={dashStyles.linkBtn} onPress={() => router.push('/report-warnings' as any)} testID="dash-students-route">
          <Text style={dashStyles.linkText}>تقرير الإنذارات</Text><Ionicons name="arrow-back" size={12} color={DASH.blue} />
        </TouchableOpacity>
      </View>

      <View style={styles.warnRow}>
        <View style={[styles.warnBox, { backgroundColor: '#fff7ed' }]} testID="dash-students-warned">
          <Text style={[styles.warnVal, NUM_FONT, { color: DASH.orange }]}>{s.warned}</Text>
          <Text style={styles.warnLbl}>إنذار (غياب &gt;25%)</Text>
        </View>
        <View style={[styles.warnBox, { backgroundColor: '#fef2f2' }]} testID="dash-students-deprived">
          <Text style={[styles.warnVal, NUM_FONT, { color: DASH.red }]}>{s.deprived}</Text>
          <Text style={styles.warnLbl}>حرمان (غياب &gt;40%)</Text>
        </View>
        <View style={[styles.warnBox, { backgroundColor: '#f8fafc' }]}>
          <Text style={[styles.warnVal, NUM_FONT, { color: DASH.muted }]}>{s.evaluated}</Text>
          <Text style={styles.warnLbl}>طالب مُقيَّم (≥3 محاضرات)</Text>
        </View>
      </View>

      <Text style={styles.sub}>حسب القسم — العدد ونسبة الحضور</Text>
      {s.by_department.length === 0 && <Text style={dashStyles.emptyText}>لا توجد بيانات</Text>}
      {s.by_department.map((d) => (
        <View key={d.department_id || d.name} style={styles.barRow} testID={`dash-students-dept-${d.department_id}`}>
          <Text style={[styles.rate, NUM_FONT, { color: rateColor(d.rate) }]}>{d.rate === null ? '—' : `${d.rate}%`}</Text>
          <View style={styles.track}><View style={[styles.fill, { width: `${(d.students / maxDept) * 100}%`, backgroundColor: DASH.blue }]} /></View>
          <Text style={[styles.count, NUM_FONT]}>{d.students}</Text>
          <Text style={styles.label} numberOfLines={1}>{d.name}</Text>
        </View>
      ))}

      <View style={styles.twoCol}>
        <View style={{ flex: 1 }}>
          <Text style={styles.sub}>حسب المستوى</Text>
          {s.by_level.map((l) => (
            <View key={l.level} style={styles.barRow}>
              <View style={[styles.track, { flex: 1 }]}><View style={[styles.fill, { width: `${(l.students / maxLvl) * 100}%`, backgroundColor: DASH.purple }]} /></View>
              <Text style={[styles.count, NUM_FONT]}>{l.students}</Text>
              <Text style={[styles.label, { flex: 0, minWidth: 70 }]}>المستوى {l.level}</Text>
            </View>
          ))}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.sub}>حالات الطلاب</Text>
          <View style={styles.stacked}>
            {s.by_status.map((st) => <View key={st.status} style={{ flex: st.count / totalStatus, backgroundColor: STATUS_COLORS[st.status] || '#94a3b8' }} />)}
          </View>
          <View style={styles.legend}>
            {s.by_status.map((st) => (
              <View key={st.status} style={styles.legendItem} testID={`dash-students-status-${st.status}`}>
                <View style={[styles.dot, { backgroundColor: STATUS_COLORS[st.status] || '#94a3b8' }]} />
                <Text style={styles.legendText}>{st.label} <Text style={[NUM_FONT, { fontWeight: '800' }]}>{st.count}</Text></Text>
              </View>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  warnRow: { flexDirection: 'row-reverse', gap: 10, marginBottom: 12 },
  warnBox: { flex: 1, borderRadius: 12, padding: 10 },
  warnVal: { fontSize: 22, fontWeight: '800', textAlign: 'right' },
  warnLbl: { fontSize: 11, color: DASH.muted, textAlign: 'right', fontWeight: '700' },
  sub: { fontSize: 12.5, fontWeight: '800', color: DASH.ink, textAlign: 'right', marginTop: 6, marginBottom: 6 },
  barRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, paddingVertical: 4 },
  label: { flex: 1.4, fontSize: 12, color: '#334155', textAlign: 'right' },
  count: { minWidth: 34, fontSize: 12, fontWeight: '800', color: DASH.ink, textAlign: 'center' },
  track: { flex: 2, height: 8, borderRadius: 4, backgroundColor: '#eef2f7', overflow: 'hidden', flexDirection: 'row-reverse' },
  fill: { height: '100%', borderRadius: 4 },
  rate: { minWidth: 48, fontSize: 12, fontWeight: '800', textAlign: 'center' },
  twoCol: { flexDirection: 'row-reverse', gap: 18, marginTop: 8, flexWrap: 'wrap' },
  stacked: { flexDirection: 'row-reverse', height: 14, borderRadius: 7, overflow: 'hidden', backgroundColor: '#eef2f7' },
  legend: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  legendItem: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5 },
  dot: { width: 9, height: 9, borderRadius: 3 },
  legendText: { fontSize: 11.5, color: '#334155' },
});
