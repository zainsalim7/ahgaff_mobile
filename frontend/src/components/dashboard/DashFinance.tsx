import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { DASH, NUM_FONT, dashStyles } from './dashTheme';

export interface FeeType { type_id: string; name: string; recurring: boolean; approved: number; pending: number; rejected: number; paid_students: number; not_paid: number; amount: number; paid_pct: number }
export interface Finance { academic_year: string; total_students: number; types: FeeType[]; total_amount: number }

const fmtAmount = (v: number) => (v ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '0');

export const DashFinance = ({ f }: { f: Finance }) => {
  const router = useRouter();
  const pending = f.types.reduce((s, t) => s + t.pending, 0);
  return (
    <View style={[dashStyles.card, { marginBottom: 16 }]} testID="dash-finance">
      <View style={dashStyles.sectionHead}>
        <View style={dashStyles.sectionTitleRow}>
          <View style={[dashStyles.iconBox, { backgroundColor: '#dcfce7' }]}><Ionicons name="cash" size={17} color={DASH.green} /></View>
          <View>
            <Text style={dashStyles.sectionTitle}>الإحصائيات المالية</Text>
            <Text style={dashStyles.sectionSub}>العام الجامعي {f.academic_year || '—'} · {f.total_students} طالب في النطاق</Text>
          </View>
        </View>
        <TouchableOpacity style={dashStyles.linkBtn} onPress={() => router.push('/fee-receipts' as any)} testID="dash-finance-route">
          <Text style={dashStyles.linkText}>السندات المالية</Text>
          <Ionicons name="arrow-back" size={12} color={DASH.blue} />
        </TouchableOpacity>
      </View>
      <View style={styles.totals}>
        <View style={[styles.totalBox, { backgroundColor: '#f0fdf4' }]}>
          <Text style={styles.totalLabel}>المبالغ المعتمدة</Text>
          <Text style={[styles.totalVal, NUM_FONT, { color: DASH.green }]} testID="dash-finance-total">{fmtAmount(f.total_amount)}</Text>
        </View>
        <View style={[styles.totalBox, { backgroundColor: pending ? '#fff7ed' : '#f8fafc' }]}>
          <Text style={styles.totalLabel}>سندات معلقة</Text>
          <Text style={[styles.totalVal, NUM_FONT, { color: pending ? DASH.orange : DASH.muted }]} testID="dash-finance-pending">{pending}</Text>
        </View>
      </View>
      {f.types.length === 0 ? (
        <View style={dashStyles.empty}><Text style={dashStyles.emptyText}>لا توجد أنواع رسوم مفعّلة</Text></View>
      ) : f.types.map((t) => (
        <View key={t.type_id} style={styles.row} testID={`dash-fee-${t.type_id}`}>
          <View style={styles.rowHead}>
            <Text style={styles.name}>{t.name}{t.recurring ? '  🔁' : ''}</Text>
            <Text style={[styles.pct, NUM_FONT, { color: t.paid_pct >= 70 ? DASH.green : t.paid_pct >= 40 ? DASH.orange : DASH.red }]}>{t.paid_pct}%</Text>
          </View>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.min(100, t.paid_pct)}%`, backgroundColor: DASH.green }]} />
            <View style={[styles.fill, { width: `${Math.min(100 - Math.min(100, t.paid_pct), f.total_students ? (t.pending * 100) / f.total_students : 0)}%`, backgroundColor: DASH.orange }]} />
          </View>
          <View style={styles.meta}>
            <Text style={[styles.metaTxt, NUM_FONT]}><Text style={{ color: DASH.green }}>●</Text> دافع {t.paid_students}</Text>
            <Text style={[styles.metaTxt, NUM_FONT]}><Text style={{ color: DASH.orange }}>●</Text> معلق {t.pending}</Text>
            <Text style={[styles.metaTxt, NUM_FONT]}><Text style={{ color: DASH.red }}>●</Text> مرفوض {t.rejected}</Text>
            <Text style={[styles.metaTxt, NUM_FONT]}><Text style={{ color: '#94a3b8' }}>●</Text> غير دافع {t.not_paid}</Text>
            {t.amount > 0 && <Text style={[styles.metaTxt, NUM_FONT, { fontWeight: '700' }]}>{fmtAmount(t.amount)}</Text>}
          </View>
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  totals: { flexDirection: 'row-reverse', gap: 10, marginBottom: 12 },
  totalBox: { flex: 1, borderRadius: 12, padding: 12 },
  totalLabel: { fontSize: 11, color: DASH.muted, textAlign: 'right', fontWeight: '700' },
  totalVal: { fontSize: 22, fontWeight: '800', textAlign: 'right', marginTop: 2 },
  row: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  rowHead: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 13, fontWeight: '700', color: DASH.ink, textAlign: 'right' },
  pct: { fontSize: 14, fontWeight: '800' },
  track: { height: 8, borderRadius: 4, backgroundColor: '#e2e8f0', overflow: 'hidden', flexDirection: 'row-reverse', marginTop: 8 },
  fill: { height: '100%' },
  meta: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 12, marginTop: 6 },
  metaTxt: { fontSize: 11, color: '#475569' },
});
