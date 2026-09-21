import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { DASH, NUM_FONT, dashStyles } from './dashTheme';

export interface Alert {
  key: string; level: 'danger' | 'warning' | 'info' | 'ok'; count: number;
  title: string; hint: string; items: any[]; route?: string;
}

const LEVEL = {
  danger: { color: DASH.red, bg: '#fef2f2', icon: 'alert-circle' as const },
  warning: { color: DASH.orange, bg: '#fff7ed', icon: 'warning' as const },
  info: { color: DASH.blue, bg: '#eff6ff', icon: 'information-circle' as const },
  ok: { color: DASH.green, bg: '#f0fdf4', icon: 'checkmark-circle' as const },
};

const itemLine = (key: string, it: any) => {
  if (key === 'low_attendance') return { main: `${it.name} (${it.student_id})`, side: `${it.rate}%`, sub: `${it.department} · م${it.level} · غياب ${it.absent}/${it.lectures}` };
  if (key === 'missed_today') return { main: it.course, side: it.time, sub: `${it.teacher} · ${it.room || 'بلا قاعة'}` };
  if (key === 'late_teachers') return { main: it.name, side: `${it.count} مرة`, sub: `أقصى تأخير ${it.max_delay} د · المجموع ${it.total_delay} د` };
  return { main: String(it.name || ''), side: '', sub: '' };
};

const AlertCard = ({ a }: { a: Alert }) => {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const lv = LEVEL[a.level] || LEVEL.info;
  const expandable = a.items?.length > 0;
  return (
    <View style={[styles.card, { borderColor: lv.color + '55', backgroundColor: a.level === 'ok' ? '#fff' : lv.bg }]} testID={`dash-alert-${a.key}`}>
      <TouchableOpacity style={styles.head} onPress={() => (expandable ? setOpen(!open) : a.route && router.push(a.route as any))} activeOpacity={0.7} testID={`dash-alert-${a.key}-toggle`}>
        <View style={[styles.countBox, { backgroundColor: lv.color }]}>
          <Text style={[styles.count, NUM_FONT]} testID={`dash-alert-${a.key}-count`}>{a.count}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{a.title}</Text>
          <Text style={styles.hint}>{a.hint}</Text>
        </View>
        <Ionicons name={expandable ? (open ? 'chevron-up' : 'chevron-down') : lv.icon} size={18} color={lv.color} />
      </TouchableOpacity>
      {open && expandable && (
        <View style={styles.list} testID={`dash-alert-${a.key}-list`}>
          {a.items.map((it, i) => {
            const l = itemLine(a.key, it);
            return (
              <View key={i} style={styles.item}>
                <Text style={[styles.side, NUM_FONT, { color: lv.color }]}>{l.side}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.main} numberOfLines={1}>{l.main}</Text>
                  <Text style={styles.sub} numberOfLines={1}>{l.sub}</Text>
                </View>
              </View>
            );
          })}
          {!!a.route && (
            <TouchableOpacity style={dashStyles.linkBtn} onPress={() => router.push(a.route as any)} testID={`dash-alert-${a.key}-route`}>
              <Text style={dashStyles.linkText}>التقرير الكامل</Text>
              <Ionicons name="arrow-back" size={12} color={DASH.blue} />
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
};

export const DashAlerts = ({ alerts }: { alerts: Alert[] }) => {
  const active = alerts.filter((a) => a.level !== 'ok').length;
  return (
    <View style={[dashStyles.card, { marginBottom: 16 }]} testID="dash-alerts">
      <View style={dashStyles.sectionHead}>
        <View style={dashStyles.sectionTitleRow}>
          <View style={[dashStyles.iconBox, { backgroundColor: '#fee2e2' }]}><Ionicons name="notifications" size={17} color={DASH.red} /></View>
          <View>
            <Text style={dashStyles.sectionTitle}>التنبيهات</Text>
            <Text style={dashStyles.sectionSub}>{active ? `${active} تنبيهات تحتاج انتباهك` : 'كل شيء على ما يرام'}</Text>
          </View>
        </View>
      </View>
      <View style={styles.grid}>
        {alerts.map((a) => <AlertCard key={a.key} a={a} />)}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  grid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 10 },
  card: { flexGrow: 1, flexBasis: 260, borderWidth: 1, borderRadius: 12, padding: 10 },
  head: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  countBox: { minWidth: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  count: { color: '#fff', fontWeight: '800', fontSize: 17 },
  title: { fontSize: 13, fontWeight: '700', color: DASH.ink, textAlign: 'right' },
  hint: { fontSize: 11, color: DASH.muted, textAlign: 'right', marginTop: 2 },
  list: { marginTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.06)', paddingTop: 8, gap: 6 },
  item: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  main: { fontSize: 12, fontWeight: '600', color: DASH.ink, textAlign: 'right' },
  sub: { fontSize: 10.5, color: DASH.muted, textAlign: 'right' },
  side: { fontSize: 12, fontWeight: '800', minWidth: 52, textAlign: 'center' },
});
