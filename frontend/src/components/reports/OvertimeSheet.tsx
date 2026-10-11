import React from 'react';
import { View, Text, Platform, StyleSheet } from 'react-native';
import { DASH, NUM_FONT } from '../dashboard/dashTheme';

const LEVELS: Record<number, string> = { 1: 'الأول', 2: 'الثاني', 3: 'الثالث', 4: 'الرابع', 5: 'الخامس', 6: 'السادس' };
export const lvl = (c: any) => `${LEVELS[c.level] || c.level || ''} ${c.section || ''}`.trim();
const f1 = (v: any) => (v === null || v === undefined || v === '' ? '' : Number(v).toFixed(1));

/** 📋 كشف الساعات الإضافية — سطر لكل مقرر مع دمج خلايا الأستاذ (HTML على الويب) */
export const OvertimeSheet: React.FC<{ teachers: any[]; period: any; threshold: number; issuer?: string }> = ({ teachers, period, threshold }) => {
  const anyBonus = teachers.some((t) => t.summary.bonus_enabled);
  const divisor = teachers.find((t) => t.summary.bonus_enabled)?.summary.bonus_divisor ?? 6;
  const anyRate = teachers.some((t) => t.summary.hourly_rate);
  const headers = ['م', 'اسم الأستاذ', 'المادة', 'المستوى', 'الساعات الأسبوعية', 'النصاب الأسبوعي', 'النصاب', 'الساعات الافتراضية', 'الساعات المنجزة', 'إجمالي المنجز',
    ...(anyBonus ? [`إضافة ساعة لكل ${divisor} ساعات`, 'الساعات بعد الإضافة (50 دقيقة)'] : []), 'إجمالي الساعات الإضافية', 'النقص', 'نسبة الإنجاز', 'الملاحظات', ...(anyRate ? ['المستحق'] : [])];

  if (Platform.OS !== 'web') {
    return (
      <View>
        {teachers.map((t, i) => (
          <View key={t.teacher_db_id || i} style={st.nCard}>
            <Text style={st.nName}>{i + 1}. {t.academic_title} {t.teacher_name}</Text>
            <Text style={st.nSub}>نصاب {f1(t.summary.required_hours)} · منجز {f1(t.summary.total_actual_hours)} · إضافية {f1(t.summary.overtime_hours)}</Text>
            {t.courses.map((c: any, k: number) => (
              <Text key={k} style={[st.nSub, c.is_low && { color: DASH.red }]}>• {c.course_name} ({lvl(c)}): {f1(c.actual_hours)}/{f1(c.expected_hours)} — {c.completion_rate}% {c.note ? `· ${c.note}` : ''}</Text>
            ))}
          </View>
        ))}
      </View>
    );
  }

  const td: React.CSSProperties = { border: '1px solid #cbd5e1', padding: '4px 5px', fontSize: 11.5, textAlign: 'center', verticalAlign: 'middle', whiteSpace: 'nowrap' };
  const th: React.CSSProperties = { ...td, backgroundColor: '#0f2440', color: '#fff', fontWeight: 800, fontSize: 11, whiteSpace: 'normal', minWidth: 52 };
  return (
    <div style={{ overflowX: 'auto', direction: 'rtl' }} data-testid="overtime-sheet">
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: '#0f2440' }}>كشف يبين الساعات الإضافية للأساتذة {period?.semester_name ? `للفصل ${period.semester_name} ${period.academic_year || ''}` : ''}</div>
        <div style={{ fontSize: 12, color: '#64748b' }}>الفترة من {String(period?.start_date || '').slice(0, 10)} إلى {String(period?.end_date || '').slice(0, 10)} · عدد الأسابيع: {period?.total_weeks}{period?.holiday_days ? ` · أيام الإجازات الرسمية: ${period.holiday_days}` : ''}{anyBonus ? '' : ' · الإضافة غير مفعّلة'}</div>
      </div>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontFamily: 'inherit' }}>
        <thead><tr>{headers.map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>
          {teachers.map((t, i) => {
            const s = t.summary;
            const cs = t.courses.length ? t.courses : [{ course_name: '—', note: 'لا مقررات', completion_rate: '', is_low: false }];
            const n = cs.length;
            return cs.map((c: any, k: number) => (
              <tr key={`${t.teacher_db_id}-${k}`} data-testid={`sheet-row-${t.teacher_db_id}-${k}`} style={{ backgroundColor: i % 2 ? '#f8fafc' : '#fff', borderTop: k === 0 && i > 0 ? '2.5px solid #334155' : undefined }}>
                {k === 0 && <td rowSpan={n} style={td}>{i + 1}</td>}
                {k === 0 && <td rowSpan={n} style={{ ...td, textAlign: 'right', fontWeight: 700, whiteSpace: 'normal', minWidth: 120 }} data-testid={`sheet-teacher-${t.teacher_db_id}`}>{t.academic_title} {t.teacher_name}<div style={{ fontSize: 10.5, color: '#64748b', fontWeight: 500 }}>{t.department_name}</div></td>}
                <td style={{ ...td, textAlign: 'right' }}>{c.course_name}{c.department_name ? <div style={{ fontSize: 10.5, color: '#64748b' }} data-testid="sheet-course-dept">{c.department_name}</div> : null}</td>
                <td style={td}>{lvl(c)}</td>
                <td style={td}>{f1(c.weekly_hours)}</td>
                {k === 0 && <td rowSpan={n} style={td}>{f1(s.weekly_hours)}</td>}
                {k === 0 && <td rowSpan={n} style={td}>{f1(s.required_hours)}</td>}
                <td style={td}>{f1(c.expected_hours)}</td>
                <td style={td}>{f1(c.actual_hours)}</td>
                {k === 0 && <td rowSpan={n} style={{ ...td, fontWeight: 700 }}>{f1(s.total_actual_hours)}</td>}
                {anyBonus && k === 0 && <td rowSpan={n} style={td} data-testid={`sheet-bonus-${t.teacher_db_id}`}>{s.bonus_enabled ? f1(s.bonus_hours) : '—'}</td>}
                {anyBonus && k === 0 && <td rowSpan={n} style={td}>{f1(s.hours_after_bonus)}</td>}
                {k === 0 && <td rowSpan={n} style={{ ...td, fontWeight: 800, color: s.overtime_hours >= 0 ? '#15803d' : '#b91c1c' }} data-testid={`sheet-overtime-${t.teacher_db_id}`}>{f1(s.overtime_hours)}</td>}
                <td style={{ ...td, color: c.shortfall_hours > 0 ? '#b91c1c' : '#334155' }}>{f1(c.shortfall_hours)}</td>
                <td style={{ ...td, fontWeight: 800, backgroundColor: c.is_low ? '#fbcfe8' : undefined }} data-testid={c.is_low ? 'sheet-low-cell' : undefined}>{c.completion_rate !== '' ? `${c.completion_rate}%` : ''}</td>
                <td style={{ ...td, textAlign: 'right', whiteSpace: 'normal', minWidth: 170, maxWidth: 220, fontSize: 10.5, color: '#475569', lineHeight: 1.5 }}>
                  {k === 0 && s.note ? <div style={{ color: '#b45309', fontWeight: 700 }} data-testid={`sheet-late-note-${t.teacher_db_id}`}>⏱ {s.note}</div> : null}
                  {c.note}
                </td>
                {anyRate && k === 0 && <td rowSpan={n} style={{ ...td, fontWeight: 700 }}>{s.overtime_amount != null ? `${Number(s.overtime_amount).toLocaleString('en')} ${s.currency || ''}` : '—'}</td>}
              </tr>
            ));
          })}
        </tbody>
      </table>
      <div style={{ fontSize: 11, color: '#64748b', marginTop: 8, lineHeight: 1.8 }}>
        المنجز = محاضرات سُجّل لها حضور بمدتها الفعلية · الافتراضية = الساعات الأسبوعية × أسابيع المقرر من التحضير الأول حتى نهاية الفترة (يُخصم غياب الأستاذ بعذر والإجازات الرسمية) · النصاب = النصاب الأسبوعي × الأسابيع من التحضير الأول للأستاذ إن بدأ متأخراً {anyBonus ? ' · الإضافة = المنجز ÷ المُقسِّم (للكليات المفعَّل فيها) · الساعات الإضافية = (المنجز + الإضافة) − النصاب' : ' · الساعات الإضافية = المنجز − النصاب'} · تُظلَّل نسبة الإنجاز الأقل من {threshold}٪
      </div>
    </div>
  );
};

const st = StyleSheet.create({
  nCard: { backgroundColor: '#fff', borderRadius: 10, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  nName: { fontSize: 13, fontWeight: '800', color: DASH.ink, textAlign: 'right' },
  nSub: { fontSize: 11, color: DASH.muted, textAlign: 'right', marginTop: 3, ...NUM_FONT },
});
