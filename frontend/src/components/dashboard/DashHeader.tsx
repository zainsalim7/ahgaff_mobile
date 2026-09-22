import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { DASH, NUM_FONT } from './dashTheme';

type Period = 'day' | 'week' | 'month';
const PERIODS: { key: Period; label: string }[] = [
  { key: 'day', label: 'اليوم' },
  { key: 'week', label: 'الأسبوع' },
  { key: 'month', label: 'الشهر' },
];

interface Props {
  userName?: string;
  scopeLabel: string;
  semester: string;
  generatedAt: string;
  period: Period;
  onPeriod: (p: Period) => void;
  exporting: '' | 'pdf' | 'excel';
  onExport: (fmt: 'pdf' | 'excel') => void;
  onRefresh: () => void;
  compact: boolean;
  readOnly?: boolean;
  canExport?: boolean;
}

export const DashHeader = ({ userName, scopeLabel, semester, generatedAt, period, onPeriod, exporting, onExport, onRefresh, compact, readOnly, canExport = true }: Props) => {
  const router = useRouter();
  return (
  <View style={styles.hero} testID="dash-header">
    <View style={styles.grain} pointerEvents="none" />
    <View style={[styles.row, compact && { flexDirection: 'column-reverse', alignItems: 'stretch', gap: 14 }]}>
      <View style={styles.actions}>
        {canExport && <TouchableOpacity style={styles.actBtn} onPress={() => router.push('/dashboard-digests' as any)} testID="dash-digests-btn">
          <Ionicons name="mail-unread-outline" size={15} color="#fff" />
          <Text style={styles.actText}>الملخصات</Text>
        </TouchableOpacity>}
        <TouchableOpacity style={styles.actBtn} onPress={onRefresh} testID="dash-refresh-btn">
          <Ionicons name="refresh" size={16} color="#fff" />
        </TouchableOpacity>
        {canExport && <TouchableOpacity style={[styles.actBtn, styles.pdfBtn]} onPress={() => onExport('pdf')} disabled={!!exporting} testID="dash-export-pdf-btn">
          {exporting === 'pdf' ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="document-text" size={15} color="#fff" />}
          <Text style={styles.actText}>PDF</Text>
        </TouchableOpacity>}
        {canExport && <TouchableOpacity style={[styles.actBtn, styles.xlsBtn]} onPress={() => onExport('excel')} disabled={!!exporting} testID="dash-export-excel-btn">
          {exporting === 'excel' ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="grid" size={15} color="#fff" />}
          <Text style={styles.actText}>Excel</Text>
        </TouchableOpacity>}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.kicker}>لوحة القيادة</Text>
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Text style={styles.title} testID="dash-title">{userName ? `مرحباً، ${userName}` : 'لوحة القيادة'}</Text>
          {readOnly && (
            <View style={styles.roBadge} testID="dash-readonly-badge">
              <Ionicons name="eye-outline" size={13} color={DASH.navy} />
              <Text style={styles.roText}>اطلاع فقط</Text>
            </View>
          )}
        </View>
        <View style={styles.metaRow}>
          <View style={styles.metaChip} testID="dash-scope-label">
            <Ionicons name="business-outline" size={12} color={DASH.gold} />
            <Text style={styles.metaText}>{scopeLabel}</Text>
          </View>
          {!!semester && (
            <View style={styles.metaChip}>
              <Ionicons name="school-outline" size={12} color={DASH.gold} />
              <Text style={styles.metaText}>{semester}</Text>
            </View>
          )}
          <View style={styles.metaChip}>
            <Ionicons name="time-outline" size={12} color={DASH.gold} />
            <Text style={[styles.metaText, NUM_FONT]}>{generatedAt}</Text>
          </View>
        </View>
      </View>
    </View>
    <View style={styles.periodBar} testID="dash-period-bar">
      {PERIODS.map((p) => (
        <TouchableOpacity
          key={p.key}
          style={[styles.periodBtn, period === p.key && styles.periodActive]}
          onPress={() => onPeriod(p.key)}
          testID={`dash-period-${p.key}`}
        >
          <Text style={[styles.periodText, period === p.key && styles.periodTextActive]}>{p.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  </View>
  );
};

const styles = StyleSheet.create({
  hero: { backgroundColor: DASH.navy, borderRadius: 20, padding: 20, overflow: 'hidden', marginBottom: 16 },
  grain: { position: 'absolute', right: -60, top: -60, width: 220, height: 220, borderRadius: 110, backgroundColor: DASH.navy2, opacity: 0.6 },
  row: { flexDirection: 'row-reverse', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  kicker: { color: DASH.gold, fontSize: 12, fontWeight: '800', letterSpacing: 1, textAlign: 'right', marginBottom: 4 },
  title: { color: '#fff', fontSize: 22, fontWeight: '800', textAlign: 'right' },
  metaRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  metaChip: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  metaText: { color: '#e2e8f0', fontSize: 12 },
  actions: { flexDirection: 'row-reverse', gap: 8, ...(Platform.OS === 'web' ? { flexShrink: 0 } : {}) },
  actBtn: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10 },
  pdfBtn: { backgroundColor: '#b91c1c' },
  xlsBtn: { backgroundColor: '#15803d' },
  actText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  roBadge: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, backgroundColor: DASH.gold, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  roText: { color: DASH.navy, fontSize: 11, fontWeight: '800' },
  periodBar: { flexDirection: 'row-reverse', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12, padding: 4, marginTop: 18, alignSelf: 'flex-end' },
  periodBtn: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 9 },
  periodActive: { backgroundColor: DASH.gold },
  periodText: { color: '#cbd5e1', fontWeight: '700', fontSize: 13 },
  periodTextActive: { color: DASH.navy },
});
