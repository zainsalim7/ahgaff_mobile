import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import Svg, { Rect, Line, Text as SvgText, Circle, Polyline } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { DASH, NUM_FONT, dashStyles } from './dashTheme';

export interface ChartPoint { label: string; date?: string; lectures: number; completed: number; present: number; late: number; absent: number; rate: number | null }
interface Props { groupBy: 'date' | 'department' | 'course'; points: ChartPoint[]; periodLabel: string; width: number }

const H = 200;
const PAD = { top: 16, bottom: 34, left: 34, right: 12 };

export const DashAttendanceChart = ({ groupBy, points, periodLabel, width }: Props) => {
  const [tip, setTip] = useState<number | null>(null);
  const hasData = points.some((p) => p.lectures > 0);
  const barW = Math.max(18, Math.min(44, (width - PAD.left - PAD.right) / Math.max(points.length, 1) - 10));
  const innerW = Math.max(width - PAD.left - PAD.right, points.length * (barW + 10));
  const svgW = innerW + PAD.left + PAD.right;
  const maxV = Math.max(1, ...points.map((p) => p.present + p.late + p.absent));
  const plotH = H - PAD.top - PAD.bottom;
  const y = (v: number) => PAD.top + plotH - (v / maxV) * plotH;
  const x = (i: number) => PAD.left + i * (innerW / Math.max(points.length, 1)) + (innerW / Math.max(points.length, 1) - barW) / 2;
  const ratePts = points.map((p, i) => (p.rate === null ? null : `${x(i) + barW / 2},${PAD.top + plotH - (p.rate / 100) * plotH}`)).filter(Boolean).join(' ');
  const gbLabel = { date: 'حسب اليوم', department: 'حسب القسم', course: 'حسب المقرر' }[groupBy];
  const sel = tip !== null ? points[tip] : null;

  return (
    <View style={[dashStyles.card, { marginBottom: 16 }]} testID="dash-attendance-chart">
      <View style={dashStyles.sectionHead}>
        <View style={dashStyles.sectionTitleRow}>
          <View style={[dashStyles.iconBox, { backgroundColor: '#dbeafe' }]}><Ionicons name="bar-chart" size={17} color={DASH.blue} /></View>
          <View>
            <Text style={dashStyles.sectionTitle}>مخطط الحضور — {periodLabel}</Text>
            <Text style={dashStyles.sectionSub}>{gbLabel} · الأعمدة: حاضر/متأخر/غائب · الخط: نسبة الحضور</Text>
          </View>
        </View>
        <View style={styles.legend}>
          {[[DASH.green, 'حاضر'], [DASH.orange, 'متأخر'], [DASH.red, 'غائب'], [DASH.navy, 'النسبة %']].map(([c, l]) => (
            <View key={l} style={styles.legendItem}><View style={[styles.dot, { backgroundColor: c }]} /><Text style={styles.legendText}>{l}</Text></View>
          ))}
        </View>
      </View>
      {!hasData ? (
        <View style={dashStyles.empty}>
          <Ionicons name="analytics-outline" size={36} color="#cbd5e1" />
          <Text style={dashStyles.emptyText}>لا توجد محاضرات منفَّذة في هذه الفترة</Text>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Svg width={svgW} height={H}>
            {[0, 0.25, 0.5, 0.75, 1].map((f) => (
              <React.Fragment key={f}>
                <Line x1={PAD.left} x2={svgW - PAD.right} y1={y(maxV * f)} y2={y(maxV * f)} stroke="#eef2f7" strokeWidth={1} />
                <SvgText x={PAD.left - 6} y={y(maxV * f) + 4} fontSize="9" fill="#94a3b8" textAnchor="end">{Math.round(maxV * f)}</SvgText>
              </React.Fragment>
            ))}
            {points.map((p, i) => {
              const total = p.present + p.late + p.absent;
              const hP = (p.present / maxV) * plotH, hL = (p.late / maxV) * plotH, hA = (p.absent / maxV) * plotH;
              const base = PAD.top + plotH;
              return (
                <React.Fragment key={i}>
                  <Rect x={x(i) - 4} y={PAD.top} width={barW + 8} height={plotH} fill={tip === i ? '#f1f5f9' : 'transparent'} onPress={() => setTip(tip === i ? null : i)} />
                  {total === 0 && <Rect x={x(i)} y={base - 2} width={barW} height={2} fill="#e2e8f0" rx={1} />}
                  <Rect x={x(i)} y={base - hP} width={barW} height={hP} fill={DASH.green} rx={2} />
                  <Rect x={x(i)} y={base - hP - hL} width={barW} height={hL} fill={DASH.orange} />
                  <Rect x={x(i)} y={base - hP - hL - hA} width={barW} height={hA} fill={DASH.red} rx={2} />
                  <SvgText x={x(i) + barW / 2} y={H - 18} fontSize="9.5" fill="#475569" textAnchor="middle">{p.label.length > 12 ? p.label.slice(0, 11) + '…' : p.label}</SvgText>
                  {p.rate !== null && (
                    <SvgText x={x(i) + barW / 2} y={H - 6} fontSize="9" fontWeight="700" fill={p.rate >= 75 ? DASH.green : DASH.red} textAnchor="middle">{`${Math.round(p.rate)}%`}</SvgText>
                  )}
                </React.Fragment>
              );
            })}
            {ratePts && <Polyline points={ratePts} fill="none" stroke={DASH.navy} strokeWidth={2} strokeDasharray="4 3" />}
            {points.map((p, i) => p.rate !== null && (
              <Circle key={`c${i}`} cx={x(i) + barW / 2} cy={PAD.top + plotH - (p.rate / 100) * plotH} r={3.5} fill="#fff" stroke={DASH.navy} strokeWidth={2} />
            ))}
          </Svg>
        </ScrollView>
      )}
      {sel && (
        <View style={styles.tip} testID="dash-chart-tooltip">
          <Text style={styles.tipTitle}>{sel.label}{sel.date ? ` (${sel.date})` : ''}</Text>
          <Text style={[styles.tipText, NUM_FONT]}>محاضرات {sel.lectures} · منفَّذة {sel.completed} · حاضر {sel.present} · متأخر {sel.late} · غائب {sel.absent}{sel.rate !== null ? ` · النسبة ${sel.rate}%` : ''}</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  legend: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 10 },
  legendItem: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4 },
  dot: { width: 9, height: 9, borderRadius: 3 },
  legendText: { fontSize: 11, color: DASH.muted },
  tip: { marginTop: 8, backgroundColor: '#f8fafc', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: DASH.line },
  tipTitle: { fontSize: 12, fontWeight: '800', color: DASH.ink, textAlign: 'right' },
  tipText: { fontSize: 11.5, color: '#334155', textAlign: 'right', marginTop: 3 },
});
