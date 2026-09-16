import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const C = { blue: '#1565c0', green: '#2e7d32', red: '#c62828', amber: '#f57f17', purple: '#4527a0', grey: '#607d8b' };
const STATUS_COLOR: Record<string, { bg: string; fg: string }> = {
  present: { bg: '#e8f5e9', fg: C.green }, excused: { bg: '#e8f5e9', fg: C.green },
  absent: { bg: '#ffebee', fg: C.red }, late: { bg: '#fff8e1', fg: C.amber },
};

const Chip = ({ label, value, testID }: { label: string; value: any; testID?: string }) => (
  <View style={s.chip} testID={testID}><Text style={s.chipTxt}>{label}: <Text style={{ color: C.blue }}>{value || '—'}</Text></Text></View>
);
const Stat = ({ v, l, bg, fg, testID }: { v: any; l: string; bg: string; fg: string; testID: string }) => (
  <View style={[s.stat, { backgroundColor: bg }]} testID={testID}><Text style={[s.statV, { color: fg }]}>{v}</Text><Text style={[s.statL, { color: fg }]}>{l}</Text></View>
);
const Pill = ({ txt, bg, fg }: { txt: string; bg: string; fg: string }) => (
  <View style={[s.pill, { backgroundColor: bg }]}><Text style={[s.pillTxt, { color: fg }]}>{txt}</Text></View>
);

const CourseBlock = ({ c, open, onToggle, compact }: { c: any; open: boolean; onToggle: () => void; compact?: boolean }) => {
  const rate = c.attendance_rate;
  const rateColor = rate === null ? C.grey : c.warning ? C.red : C.green;
  return (
    <View style={[s.course, { borderRightColor: c.warning ? C.red : C.blue }]} testID={`sr-course-${c.course_id}`}>
      <TouchableOpacity onPress={onToggle} style={s.courseHead} testID={`sr-course-toggle-${c.course_id}`}>
        <View style={{ flex: 1 }}>
          <Text style={s.courseName}>{c.course_name} <Text style={s.courseMeta}>{c.course_code}{c.teacher_name ? ` · ${c.teacher_name}` : ''}</Text></Text>
          <View style={s.pills}>
            <Pill txt={`${c.total_lectures} محاضرة مدرجة`} bg="#e3f2fd" fg={C.blue} />
            <Pill txt={`حاضر ${c.present}`} bg="#e8f5e9" fg={C.green} />
            <Pill txt={`غائب ${c.absent}`} bg="#ffebee" fg={C.red} />
            <Pill txt={`متأخر ${c.late}`} bg="#fff8e1" fg={C.amber} />
            <Pill txt={`قادمة ${c.upcoming}`} bg="#f1f4f9" fg={C.grey} />
            {c.cancelled > 0 && <Pill txt={`ملغاة ${c.cancelled}`} bg="#f1f4f9" fg={C.grey} />}
          </View>
        </View>
        <View style={{ alignItems: 'center', gap: 4 }}>
          <Text style={[s.rate, { color: rateColor }]} testID={`sr-course-rate-${c.course_id}`}>{rate === null ? '—' : `${rate}%`}{c.warning ? ' ⚠️' : ''}</Text>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={C.grey} />
        </View>
      </TouchableOpacity>
      {open && compact && (
        <View testID={`sr-course-lectures-${c.course_id}`}>
          {c.lectures.length === 0 && <Text style={s.empty}>لا توجد محاضرات مدرجة لهذا المقرر في الفصل النشط</Text>}
          {c.lectures.map((l: any) => {
            const sc = STATUS_COLOR[l.student_status] || { bg: '#f1f4f9', fg: C.grey };
            const cancelled = l.lecture_status === 'cancelled' || l.lecture_status === 'absent';
            return (
              <View key={l.id} style={[s.mrow, cancelled || l.lecture_status === 'scheduled' ? { opacity: 0.65 } : null]} testID={`sr-lecture-${l.id}`}>
                <View style={{ minWidth: 86 }}>
                  <Text style={s.mdate}>{l.date}</Text>
                  <Text style={s.msub}>{l.day}{l.time ? ` · ${l.time.split(' - ')[0]}` : ''}{l.room ? ` · ${l.room}` : ''}</Text>
                </View>
                <Text style={[s.mtopic, cancelled ? { color: C.red } : null]} numberOfLines={2}>
                  {cancelled ? `${l.lecture_status_label}${l.cancellation_reason ? ` (${l.cancellation_reason})` : ''}` : (l.topic || '—')}
                </Text>
                <View style={[s.st, { backgroundColor: sc.bg }]}><Text style={[s.stTxt, { color: sc.fg }]}>{cancelled ? '—' : l.student_status_label}</Text></View>
              </View>
            );
          })}
        </View>
      )}
      {open && !compact && (
        <View testID={`sr-course-lectures-${c.course_id}`}>
          <View style={[s.row, s.rowHead]}>
            {['#', 'التاريخ', 'اليوم', 'الوقت', 'القاعة', 'الموضوع', 'حالة المحاضرة', 'حالة الطالب'].map((h, i) => (
              <Text key={h} style={[s.cell, s.cellHead, COLW[i]]}>{h}</Text>
            ))}
          </View>
          {c.lectures.length === 0 && <Text style={s.empty}>لا توجد محاضرات مدرجة لهذا المقرر في الفصل النشط</Text>}
          {c.lectures.map((l: any, i: number) => {
            const sc = STATUS_COLOR[l.student_status] || { bg: '#f1f4f9', fg: C.grey };
            const cancelled = l.lecture_status === 'cancelled' || l.lecture_status === 'absent';
            return (
              <View key={l.id} style={[s.row, i % 2 ? s.rowAlt : null]} testID={`sr-lecture-${l.id}`}>
                <Text style={[s.cell, COLW[0]]}>{l.n}</Text>
                <Text style={[s.cell, COLW[1]]}>{l.date}</Text>
                <Text style={[s.cell, COLW[2]]}>{l.day}</Text>
                <Text style={[s.cell, COLW[3]]}>{l.time}</Text>
                <Text style={[s.cell, COLW[4]]}>{l.room || '—'}</Text>
                <Text style={[s.cell, COLW[5]]} numberOfLines={1}>{l.topic || '—'}</Text>
                <Text style={[s.cell, COLW[6], { color: cancelled ? C.red : l.lecture_status === 'completed' ? '#333' : C.grey }]}>
                  {l.lecture_status_label}{l.cancellation_reason ? ` (${l.cancellation_reason})` : ''}
                </Text>
                <View style={[s.cell, COLW[7], { alignItems: 'center' }]}>
                  <View style={[s.st, { backgroundColor: sc.bg }]}><Text style={[s.stTxt, { color: sc.fg }]}>{l.student_status_label}</Text></View>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
};

const SUM_COLS = ['#', 'المقرر', 'الرمز', 'الأستاذ', 'المدرجة', 'المنفَّذة', 'حاضر', 'غائب', 'متأخر', 'قادمة', 'ملغاة', 'نسبة الحضور'];
const SUMW = [{ width: 32 }, { flex: 1, minWidth: 160 }, { width: 70 }, { width: 140 }, { width: 62 }, { width: 62 }, { width: 55 }, { width: 55 }, { width: 55 }, { width: 55 }, { width: 55 }, { width: 90 }];

const SummaryTable = ({ courses, sm, compact }: { courses: any[]; sm: any; compact?: boolean }) => {
  const rate = sm.overall_attendance_rate;
  if (compact) {
    const CW = [{ flex: 1, minWidth: 90 }, { width: 42 }, { width: 42 }, { width: 42 }, { width: 42 }, { width: 42 }, { width: 58 }];
    const H = ['المقرر', 'مدرجة', 'حاضر', 'غائب', 'متأخر', 'قادمة', 'النسبة'];
    return (
      <View testID="sr-summary-table">
        <View style={[s.row, s.rowHead]}>{H.map((h, i) => <Text key={h} style={[s.cell, s.cellHead, CW[i], { fontSize: 10.5 }]}>{h}</Text>)}</View>
        {courses.map((c: any, i: number) => (
          <View key={c.course_id} style={[s.row, i % 2 ? s.rowAlt : null]} testID={`sr-summary-row-${c.course_id}`}>
            <Text style={[s.cell, CW[0], { fontWeight: '800', textAlign: 'right', fontSize: 11 }]} numberOfLines={2}>{c.course_name}</Text>
            <Text style={[s.cell, CW[1], { fontSize: 11 }]}>{c.total_lectures}</Text>
            <Text style={[s.cell, CW[2], { fontSize: 11, color: C.green }]}>{c.present}</Text>
            <Text style={[s.cell, CW[3], { fontSize: 11, color: C.red }]}>{c.absent}</Text>
            <Text style={[s.cell, CW[4], { fontSize: 11, color: C.amber }]}>{c.late}</Text>
            <Text style={[s.cell, CW[5], { fontSize: 11 }]}>{c.upcoming}</Text>
            <Text style={[s.cell, CW[6], { fontWeight: '900', fontSize: 11, color: c.attendance_rate === null ? C.grey : c.warning ? C.red : C.green }]}>{c.attendance_rate === null ? '—' : `${c.attendance_rate}%`}{c.warning ? ' ⚠️' : ''}</Text>
          </View>
        ))}
        <View style={[s.row, { backgroundColor: '#e3f2fd' }]} testID="sr-summary-total">
          {['الإجمالي', sm.total_lectures, sm.present, sm.absent, sm.late, sm.upcoming, rate === null ? '—' : `${rate}%`].map((v, j) => (
            <Text key={j} style={[s.cell, CW[j], { fontWeight: '900', color: '#1a2540', fontSize: 11 }, j === 0 ? { textAlign: 'right' } : null]}>{v}</Text>
          ))}
        </View>
      </View>
    );
  }
  return (
    <View testID="sr-summary-table">
      <View style={[s.row, s.rowHead]}>{SUM_COLS.map((h, i) => <Text key={h} style={[s.cell, s.cellHead, SUMW[i]]}>{h}</Text>)}</View>
      {courses.map((c: any, i: number) => {
        const vals = [i + 1, c.course_name, c.course_code, c.teacher_name || '—', c.total_lectures, c.executed, c.present, c.absent, c.late, c.upcoming, c.cancelled];
        return (
          <View key={c.course_id} style={[s.row, i % 2 ? s.rowAlt : null]} testID={`sr-summary-row-${c.course_id}`}>
            {vals.map((v, j) => <Text key={j} style={[s.cell, SUMW[j], j === 1 ? { fontWeight: '800', textAlign: 'right' } : null, j === 6 ? { color: C.green } : null, j === 7 ? { color: C.red } : null, j === 8 ? { color: C.amber } : null]} numberOfLines={1}>{v}</Text>)}
            <Text style={[s.cell, SUMW[11], { fontWeight: '900', color: c.attendance_rate === null ? C.grey : c.warning ? C.red : C.green }]}>{c.attendance_rate === null ? '—' : `${c.attendance_rate}%`}{c.warning ? ' ⚠️' : ''}</Text>
          </View>
        );
      })}
      <View style={[s.row, { backgroundColor: '#e3f2fd' }]} testID="sr-summary-total">
        {['', 'الإجمالي', '', '', sm.total_lectures, sm.executed, sm.present, sm.absent, sm.late, sm.upcoming, sm.cancelled, rate === null ? '—' : `${rate}%`].map((v, j) => (
          <Text key={j} style={[s.cell, SUMW[j], { fontWeight: '900', color: '#1a2540' }, j === 1 ? { textAlign: 'right' } : null]}>{v}</Text>
        ))}
      </View>
    </View>
  );
};

export const StudentDetailedReport = ({ data, mode = 'detailed', compact = false }: { data: any; mode?: 'detailed' | 'summary'; compact?: boolean }) => {
  const { student: st, semester: sem, summary: sm, courses } = data;
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const allOpen = courses.length > 0 && openIds.size === courses.length;
  const toggle = (id: string) => setOpenIds((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const rate = sm.overall_attendance_rate;
  return (
    <View testID="student-detailed-report">
      <View style={s.card}>
        <View style={s.hdr}>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 14, flex: 1 }}>
            <View style={s.avatar}><Text style={s.avatarTxt}>{(st.full_name || '؟').trim().charAt(0)}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={s.name} testID="sr-student-name">{st.full_name}</Text>
              <View style={s.chips}>
                <Chip label="رقم القيد" value={st.student_id} testID="sr-student-id" />
                <Chip label="الكلية" value={st.faculty_name} />
                <Chip label="القسم" value={st.department_name} testID="sr-student-dept" />
                <Chip label="المستوى" value={st.level_label} testID="sr-student-level" />
                <Chip label="الشعبة" value={st.section} testID="sr-student-section" />
              </View>
            </View>
          </View>
          <View style={{ alignItems: 'flex-start', width: compact ? '100%' : undefined, borderTopWidth: compact ? 1 : 0, borderTopColor: '#eef1f6', paddingTop: compact ? 6 : 0 }}>
            <Text style={s.semTitle}>الفصل الدراسي النشط</Text>
            <Text style={s.semTxt} testID="sr-semester">{sem.name} {sem.academic_year}</Text>
            {sem.start_date && <Text style={s.semTxt}>من {sem.start_date} إلى {sem.end_date}</Text>}
            <Text style={[s.semTxt, { color: '#90a4ae' }]}>تاريخ التقرير: {data.generated_at}</Text>
          </View>
        </View>
        <View style={s.stats}>
          {!compact && <Stat v={sm.total_courses} l="المقررات" bg="#ede7f6" fg={C.purple} testID="sr-stat-courses" />}
          <Stat v={sm.total_lectures} l="المحاضرات المدرجة" bg="#e3f2fd" fg={C.blue} testID="sr-stat-lectures" />
          <Stat v={sm.present} l="حاضر" bg="#e8f5e9" fg={C.green} testID="sr-stat-present" />
          <Stat v={sm.absent} l="غائب" bg="#ffebee" fg={C.red} testID="sr-stat-absent" />
          <Stat v={sm.late} l="متأخر" bg="#fff8e1" fg={C.amber} testID="sr-stat-late" />
        </View>
        <View style={s.bar}><View style={[s.barFill, { width: `${rate ?? 0}%` as any, backgroundColor: rate !== null && rate < 75 ? C.red : C.green }]} /></View>
        <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', marginTop: 4 }}>
          <Text style={s.barLbl} testID="sr-overall-rate">{compact ? 'نسبة حضورك' : 'نسبة الحضور العامة'}: <Text style={{ fontWeight: '900', color: rate !== null && rate < 75 ? C.red : C.green }}>{rate === null ? '—' : `${rate}%`}</Text> (من {sm.executed} محاضرة مُنفَّذة)</Text>
          <Text style={s.barLbl}>{sm.upcoming} محاضرة قادمة لم تُنفَّذ بعد{sm.cancelled ? ` · ${sm.cancelled} ملغاة` : ''}</Text>
        </View>
      </View>

      {mode === 'summary' && (
        <View style={s.card}>
          <Text style={[s.secTitle, { marginBottom: 10 }]}>{compact ? 'ملخص مقرراتي' : 'ملخص المقررات — الفصل النشط'} ({courses.length})</Text>
          {courses.length === 0 ? <Text style={s.empty}>لا توجد مقررات مسجلة للطالب في الفصل النشط</Text> : <SummaryTable courses={courses} sm={sm} compact={compact} />}
          <Text style={s.foot}>🔴 نسبة الحضور تُحسب من المحاضرات المنفَّذة فقط — تحذير لأي مقرر تحت 75%</Text>
        </View>
      )}

      {mode === 'detailed' && <View style={s.card}>
        <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <Text style={s.secTitle}>{compact ? 'مقرراتي' : 'المقررات والمحاضرات المدرجة للفصل النشط'} ({courses.length})</Text>
          <TouchableOpacity onPress={() => setOpenIds(allOpen ? new Set() : new Set(courses.map((c: any) => c.course_id)))} testID="sr-toggle-all">
            <Text style={{ color: C.blue, fontWeight: '800', fontSize: 12 }}>{allOpen ? 'طيّ الكل ▲' : 'فتح الكل ▼'}</Text>
          </TouchableOpacity>
        </View>
        {courses.length === 0 && <Text style={s.empty}>لا توجد مقررات مسجلة للطالب في الفصل النشط</Text>}
        {courses.map((c: any) => <CourseBlock key={c.course_id} c={c} open={openIds.has(c.course_id)} onToggle={() => toggle(c.course_id)} compact={compact} />)}
        <Text style={s.foot}>🔴 يظهر تحذير أحمر بجانب أي مقرر تقل نسبة حضوره عن 75% — المحاضرات الملغاة تظهر ولا تُحسب</Text>
      </View>}
    </View>
  );
};

const COLW = [{ width: 32 }, { width: 90 }, { width: 70 }, { width: 100 }, { width: 80 }, { flex: 1, minWidth: 120 }, { width: 120 }, { width: 110 }];
const s = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginHorizontal: 16, marginBottom: 14, ...(Platform.OS === 'web' ? { boxShadow: '0 2px 8px rgba(0,0,0,.05)' } as any : {}) },
  hdr: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, borderBottomWidth: 2, borderBottomColor: C.blue, paddingBottom: 14, flexWrap: 'wrap' },
  avatar: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#e3f2fd', alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 26, fontWeight: '900', color: C.blue },
  name: { fontSize: 22, fontWeight: '900', color: '#1a2540', textAlign: 'right' },
  mrow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 10, borderTopWidth: 1, borderTopColor: '#f0f2f5' },
  mdate: { fontSize: 12, fontWeight: '800', color: '#1a2540' },
  msub: { fontSize: 10, color: '#78909c', marginTop: 1 },
  mtopic: { flex: 1, fontSize: 11, color: '#455a64', textAlign: 'right' },
  chips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  chip: { backgroundColor: '#f1f4f9', borderRadius: 20, paddingVertical: 4, paddingHorizontal: 12 },
  chipTxt: { fontSize: 12, fontWeight: '700', color: '#37474f' },
  semTitle: { fontSize: 13, fontWeight: '800', color: '#1a2540' },
  semTxt: { fontSize: 12, color: C.grey, marginTop: 2 },
  stats: { flexDirection: 'row-reverse', gap: 10, marginTop: 16, flexWrap: 'wrap' },
  stat: { flex: 1, minWidth: 120, borderRadius: 12, padding: 12, alignItems: 'center' },
  statV: { fontSize: 24, fontWeight: '900' },
  statL: { fontSize: 11, fontWeight: '700', marginTop: 2 },
  bar: { height: 10, backgroundColor: '#eceff1', borderRadius: 6, overflow: 'hidden', marginTop: 14, flexDirection: 'row-reverse' },
  barFill: { height: '100%', borderRadius: 6 },
  barLbl: { fontSize: 11, color: C.grey },
  secTitle: { fontSize: 16, fontWeight: '900', color: '#1a2540' },
  course: { borderWidth: 1, borderColor: '#e3e8ef', borderRadius: 12, marginBottom: 12, overflow: 'hidden', borderRightWidth: 5 },
  courseHead: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', padding: 12, backgroundColor: '#f7f9fc', gap: 10 },
  courseName: { fontSize: 15, fontWeight: '900', color: '#1a2540', textAlign: 'right' },
  courseMeta: { fontSize: 12, fontWeight: '700', color: '#78909c' },
  pills: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  pill: { borderRadius: 20, paddingVertical: 3, paddingHorizontal: 10 },
  pillTxt: { fontSize: 11, fontWeight: '800' },
  rate: { fontSize: 17, fontWeight: '900' },
  row: { flexDirection: 'row-reverse', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#eef1f6' },
  rowHead: { backgroundColor: C.blue },
  rowAlt: { backgroundColor: '#fafbfd' },
  cell: { fontSize: 12, color: '#333', textAlign: 'center', paddingHorizontal: 3 },
  cellHead: { color: '#fff', fontWeight: '800' },
  st: { borderRadius: 6, paddingVertical: 2, paddingHorizontal: 10, minWidth: 72, alignItems: 'center' },
  stTxt: { fontSize: 11.5, fontWeight: '800' },
  empty: { textAlign: 'center', color: '#999', padding: 14, fontSize: 12 },
  foot: { fontSize: 11, color: '#90a4ae', textAlign: 'center', marginTop: 6 },
});
