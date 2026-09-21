import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { DASH, NUM_FONT, dashStyles } from './dashTheme';

interface Numbers {
  students: number; teachers: number; courses: number; departments: number; faculties: number;
  lectures_today: number; today_done: number; today_cancelled: number; today_upcoming: number;
  lectures_period: number; lectures_status: Record<string, number>;
  attendance_rate: number | null; present: number; late: number; absent: number;
}

interface Kpi { key: string; label: string; value: string | number; sub?: string; icon: keyof typeof Ionicons.glyphMap; color: string; route?: string }

export const DashKpis = ({ n, periodLabel, compact }: { n: Numbers; periodLabel: string; compact: boolean }) => {
  const router = useRouter();
  const rate = n.attendance_rate;
  const rateColor = rate === null ? DASH.muted : rate >= 75 ? DASH.green : rate >= 60 ? DASH.orange : DASH.red;
  const kpis: Kpi[] = [
    { key: 'students', label: 'الطلاب النشطون', value: n.students, icon: 'people', color: DASH.blue, route: '/students', sub: `${n.departments} قسم · ${n.faculties} كلية` },
    { key: 'teachers', label: 'الأساتذة', value: n.teachers, icon: 'person', color: DASH.teal, route: '/manage-teachers' },
    { key: 'courses', label: 'مقررات الفصل النشط', value: n.courses, icon: 'book', color: DASH.purple, route: '/(tabs)/courses' },
    { key: 'today', label: 'محاضرات اليوم', value: n.lectures_today, icon: 'calendar', color: DASH.orange, route: '/schedule', sub: `منفَّذة ${n.today_done} · قادمة ${n.today_upcoming} · ملغاة ${n.today_cancelled}` },
    { key: 'period', label: `محاضرات ${periodLabel}`, value: n.lectures_period, icon: 'layers', color: DASH.navy2, route: '/report-lesson-completion', sub: `منفَّذة ${n.lectures_status?.completed || 0} · ملغاة ${(n.lectures_status?.cancelled || 0) + (n.lectures_status?.absent || 0)}` },
    { key: 'rate', label: 'نسبة الحضور', value: rate === null ? '—' : `${rate}%`, icon: 'pulse', color: rateColor, route: '/report-attendance-overview', sub: `حاضر ${n.present} · متأخر ${n.late} · غائب ${n.absent}` },
  ];
  return (
    <View style={styles.grid} testID="dash-kpis">
      {kpis.map((k) => (
        <TouchableOpacity
          key={k.key}
          style={[dashStyles.card, styles.kpi, compact && styles.kpiCompact]}
          onPress={() => k.route && router.push(k.route as any)}
          activeOpacity={0.75}
          testID={`dash-kpi-${k.key}`}
        >
          <View style={[styles.accent, { backgroundColor: k.color }]} />
          <View style={styles.top}>
            <View style={[dashStyles.iconBox, { backgroundColor: k.color + '1a' }]}>
              <Ionicons name={k.icon} size={18} color={k.color} />
            </View>
            <Text style={styles.label}>{k.label}</Text>
          </View>
          <Text style={[styles.value, NUM_FONT, { color: k.color }]} testID={`dash-kpi-${k.key}-value`}>{k.value}</Text>
          {!!k.sub && <Text style={[styles.sub, NUM_FONT]} numberOfLines={1}>{k.sub}</Text>}
        </TouchableOpacity>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  grid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 12, marginBottom: 16 },
  kpi: { flexGrow: 1, flexBasis: 200, minWidth: 180, overflow: 'hidden' },
  kpiCompact: { flexBasis: '46%', minWidth: 150 },
  accent: { position: 'absolute', top: 0, right: 0, left: 0, height: 4 },
  top: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginBottom: 10 },
  label: { fontSize: 12, fontWeight: '700', color: DASH.muted, textAlign: 'right', flex: 1 },
  value: { fontSize: 30, fontWeight: '800', textAlign: 'right', lineHeight: 36 },
  sub: { fontSize: 11, color: '#94a3b8', textAlign: 'right', marginTop: 4 },
});
