import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { DASH, NUM_FONT, dashStyles } from './dashTheme';

export interface ActivityItem { id: string; username: string; role: string; action: string; entity: string; time: string }

const ROLE_AR: Record<string, string> = { admin: 'مدير', dean: 'عميد', department_head: 'رئيس قسم', teacher: 'أستاذ', student: 'طالب', employee: 'موظف', registrar: 'تسجيل', registration_manager: 'مدير تسجيل', custom: 'مخصص' };

const iconFor = (action: string): [keyof typeof Ionicons.glyphMap, string] => {
  if (/حذف|مسح/.test(action)) return ['trash', DASH.red];
  if (/إنشاء|إضافة|تسجيل دفع|إصدار|توليد/.test(action)) return ['add-circle', DASH.green];
  if (/تعديل|تحديث|نقل|تبديل|إعادة/.test(action)) return ['create', DASH.orange];
  if (/تسجيل دخول|خروج/.test(action)) return ['log-in', DASH.muted];
  if (/تصدير|استيراد/.test(action)) return ['swap-vertical', DASH.purple];
  if (/حضور/.test(action)) return ['checkmark-done', DASH.teal];
  return ['ellipse', DASH.blue];
};

export const DashActivity = ({ items, canOpenLog }: { items: ActivityItem[]; canOpenLog: boolean }) => {
  const router = useRouter();
  return (
    <View style={[dashStyles.card, { marginBottom: 16 }]} testID="dash-activity">
      <View style={dashStyles.sectionHead}>
        <View style={dashStyles.sectionTitleRow}>
          <View style={[dashStyles.iconBox, { backgroundColor: '#ede9fe' }]}><Ionicons name="time" size={17} color={DASH.purple} /></View>
          <View>
            <Text style={dashStyles.sectionTitle}>آخر الأنشطة</Text>
            <Text style={dashStyles.sectionSub}>أحدث {items.length} إجراء ضمن نطاقك</Text>
          </View>
        </View>
        {canOpenLog && (
          <TouchableOpacity style={dashStyles.linkBtn} onPress={() => router.push('/activity-logs' as any)} testID="dash-activity-route">
            <Text style={dashStyles.linkText}>السجل الكامل</Text>
            <Ionicons name="arrow-back" size={12} color={DASH.blue} />
          </TouchableOpacity>
        )}
      </View>
      {items.length === 0 ? (
        <View style={dashStyles.empty}><Ionicons name="file-tray-outline" size={32} color="#cbd5e1" /><Text style={dashStyles.emptyText}>لا توجد أنشطة مسجلة</Text></View>
      ) : items.map((a, i) => {
        const [icon, color] = iconFor(a.action);
        return (
          <View key={a.id} style={[styles.item, i < items.length - 1 && styles.itemLine]} testID={`dash-activity-item-${i}`}>
            <View style={[styles.ico, { backgroundColor: color + '1a' }]}><Ionicons name={icon} size={14} color={color} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.action} numberOfLines={1}>
                <Text style={{ fontWeight: '800' }}>{a.username}</Text>
                {a.role ? <Text style={styles.role}> ({ROLE_AR[a.role] || a.role})</Text> : null} · {a.action}
              </Text>
              {!!a.entity && <Text style={styles.entity} numberOfLines={1}>{a.entity}</Text>}
            </View>
            <Text style={[styles.time, NUM_FONT]}>{a.time.slice(5)}</Text>
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  item: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, paddingVertical: 8 },
  itemLine: { borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  ico: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  action: { fontSize: 12.5, color: DASH.ink, textAlign: 'right' },
  role: { color: DASH.muted, fontSize: 11 },
  entity: { fontSize: 11, color: DASH.muted, textAlign: 'right', marginTop: 1 },
  time: { fontSize: 10.5, color: '#94a3b8', minWidth: 68, textAlign: 'left' },
});
