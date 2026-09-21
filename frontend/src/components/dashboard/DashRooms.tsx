import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { DASH, NUM_FONT, dashStyles } from './dashTheme';

interface RoomRow { room: string; slots: number; occupancy: number }
export interface RoomsStats {
  capacity_per_room: number; rooms_used: number; total_slots: number; avg_occupancy: number;
  most_used: RoomRow[]; least_used: RoomRow[]; rows: RoomRow[];
  unscheduled_courses: { id: string; name: string; code: string; department: string }[]; unscheduled_count: number;
  today_heatmap: { time: string; total: number; completed: number; cancelled: number; scheduled: number }[];
}

const occColor = (o: number) => (o >= 70 ? DASH.red : o >= 40 ? DASH.orange : DASH.green);

export const DashRooms = ({ r }: { r: RoomsStats }) => {
  const router = useRouter();
  const [showUnsched, setShowUnsched] = useState(false);
  const maxHeat = Math.max(1, ...r.today_heatmap.map((h) => h.total));
  return (
    <View style={[dashStyles.card, { marginBottom: 16 }]} testID="dash-rooms">
      <View style={dashStyles.sectionHead}>
        <View style={dashStyles.sectionTitleRow}>
          <View style={[dashStyles.iconBox, { backgroundColor: '#ffedd5' }]}><Ionicons name="business" size={17} color={DASH.orange} /></View>
          <View>
            <Text style={dashStyles.sectionTitle}>القاعات والجدول</Text>
            <Text style={dashStyles.sectionSub}>إشغال القاعات في الجدول الأسبوعي ({r.capacity_per_room} فترة/أسبوع لكل قاعة) · المقررات غير المدرجة · محاضرات اليوم</Text>
          </View>
        </View>
        <TouchableOpacity style={dashStyles.linkBtn} onPress={() => router.push('/availability-report' as any)} testID="dash-rooms-route">
          <Text style={dashStyles.linkText}>تقرير توفر القاعات</Text><Ionicons name="arrow-back" size={12} color={DASH.blue} />
        </TouchableOpacity>
      </View>

      <View style={styles.minis}>
        {[
          ['قاعات مستخدمة', r.rooms_used, DASH.orange],
          ['خانات مجدولة', r.total_slots, DASH.navy2],
          ['متوسط الإشغال', `${r.avg_occupancy}%`, occColor(r.avg_occupancy)],
          ['مقررات غير مدرجة', r.unscheduled_count, r.unscheduled_count ? DASH.red : DASH.green],
        ].map(([l, v, c]) => (
          <View key={String(l)} style={[styles.mini, { borderColor: String(c) + '55' }]}>
            <Text style={[styles.miniVal, NUM_FONT, { color: String(c) }]}>{v as any}</Text>
            <Text style={styles.miniLbl}>{l}</Text>
          </View>
        ))}
      </View>

      <View style={styles.twoCol}>
        <View style={{ flex: 1, minWidth: 260 }}>
          <Text style={styles.sub}>الأكثر إشغالاً</Text>
          {r.most_used.length === 0 && <Text style={dashStyles.emptyText}>لا توجد خانات في الجدول</Text>}
          {r.most_used.map((x) => (
            <View key={x.room} style={styles.barRow} testID={`dash-room-${x.room}`}>
              <Text style={[styles.pct, NUM_FONT, { color: occColor(x.occupancy) }]}>{x.occupancy}%</Text>
              <View style={styles.track}><View style={[styles.fill, { width: `${Math.min(100, x.occupancy)}%`, backgroundColor: occColor(x.occupancy) }]} /></View>
              <Text style={styles.roomName} numberOfLines={1}>{x.room} <Text style={[NUM_FONT, { color: DASH.muted, fontSize: 10.5 }]}>({x.slots})</Text></Text>
            </View>
          ))}
          {r.least_used.length > 0 && r.rows.length > 5 && (
            <>
              <Text style={styles.sub}>الأقل إشغالاً</Text>
              {r.least_used.map((x) => (
                <View key={x.room} style={styles.barRow}>
                  <Text style={[styles.pct, NUM_FONT, { color: DASH.muted }]}>{x.occupancy}%</Text>
                  <View style={styles.track}><View style={[styles.fill, { width: `${Math.min(100, x.occupancy)}%`, backgroundColor: '#94a3b8' }]} /></View>
                  <Text style={styles.roomName} numberOfLines={1}>{x.room} <Text style={[NUM_FONT, { color: DASH.muted, fontSize: 10.5 }]}>({x.slots})</Text></Text>
                </View>
              ))}
            </>
          )}
        </View>
        <View style={{ flex: 1, minWidth: 260 }}>
          <Text style={styles.sub}>محاضرات اليوم حسب وقت البداية</Text>
          {r.today_heatmap.length === 0 ? <Text style={dashStyles.emptyText}>لا محاضرات اليوم</Text> : r.today_heatmap.map((h) => (
            <View key={h.time} style={styles.barRow} testID={`dash-heat-${h.time}`}>
              <Text style={[styles.pct, NUM_FONT]}>{h.total}</Text>
              <View style={[styles.track, { flexDirection: 'row-reverse' }]}>
                <View style={{ width: `${(h.completed / maxHeat) * 100}%`, backgroundColor: DASH.green }} />
                <View style={{ width: `${(h.scheduled / maxHeat) * 100}%`, backgroundColor: DASH.blue }} />
                <View style={{ width: `${(h.cancelled / maxHeat) * 100}%`, backgroundColor: DASH.red }} />
              </View>
              <Text style={[styles.roomName, NUM_FONT, { flex: 0, minWidth: 48 }]}>{h.time}</Text>
            </View>
          ))}
          {r.today_heatmap.length > 0 && <Text style={styles.legend}>🟩 منفَّذة · 🟦 مجدولة · 🟥 ملغاة</Text>}
        </View>
      </View>

      {r.unscheduled_count > 0 && (
        <View style={styles.unsched}>
          <TouchableOpacity style={styles.unschedHead} onPress={() => setShowUnsched(!showUnsched)} testID="dash-unscheduled-toggle">
            <Ionicons name={showUnsched ? 'chevron-up' : 'chevron-down'} size={16} color={DASH.red} />
            <Text style={styles.unschedTitle}>مقررات الفصل النشط غير المدرجة في الجدول ({r.unscheduled_count})</Text>
          </TouchableOpacity>
          {showUnsched && r.unscheduled_courses.map((c) => (
            <Text key={c.id} style={styles.unschedItem} numberOfLines={1}>• {c.name} {c.code ? `(${c.code})` : ''} — {c.department}</Text>
          ))}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  minis: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  mini: { flexGrow: 1, flexBasis: 140, borderWidth: 1, borderRadius: 12, padding: 10, backgroundColor: '#fafbfd' },
  miniVal: { fontSize: 20, fontWeight: '800', textAlign: 'right' },
  miniLbl: { fontSize: 11, color: DASH.muted, textAlign: 'right', marginTop: 2 },
  twoCol: { flexDirection: 'row-reverse', gap: 18, flexWrap: 'wrap' },
  sub: { fontSize: 12.5, fontWeight: '800', color: DASH.ink, textAlign: 'right', marginTop: 6, marginBottom: 6 },
  barRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, paddingVertical: 4 },
  roomName: { flex: 1.2, fontSize: 12, color: '#334155', textAlign: 'right', fontWeight: '700' },
  track: { flex: 2, height: 9, borderRadius: 5, backgroundColor: '#eef2f7', overflow: 'hidden', flexDirection: 'row-reverse' },
  fill: { height: '100%', borderRadius: 5 },
  pct: { minWidth: 46, fontSize: 12, fontWeight: '800', textAlign: 'center', color: DASH.ink },
  legend: { fontSize: 10.5, color: DASH.muted, textAlign: 'right', marginTop: 4 },
  unsched: { marginTop: 12, backgroundColor: '#fef2f2', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#fecaca' },
  unschedHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  unschedTitle: { fontSize: 12.5, fontWeight: '800', color: DASH.red, flex: 1, textAlign: 'right' },
  unschedItem: { fontSize: 11.5, color: '#7f1d1d', textAlign: 'right', marginTop: 5 },
});
