import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Platform, Alert, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { courseGroupsAPI } from '../src/services/api';
import { groupColor } from '../src/components/CourseGroupsModal';
import { GroupsExcelBar } from '../src/components/groups/GroupsExcelBar';

const notify = (t: string, m: string) => (Platform.OS === 'web' ? window.alert(`${t}\n${m}`) : Alert.alert(t, m));
const STATUS_COLOR: Record<string, string> = { excellent: '#2e7d32', ok: '#1565c0', warning: '#ef6c00', danger: '#c62828', deprived: '#7f1d1d' };

/** 👥 صفحة مجموعة دراسية: طلابها + قائدها + جدولها + تصدير/استيراد + نقل طالب */
export default function CourseGroupPage() {
  const { courseId, group } = useLocalSearchParams<{ courseId: string; group: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [moveFor, setMoveFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!courseId || !group) return;
    setLoading(true);
    try { const r = await courseGroupsAPI.detail(String(courseId), String(group)); setData(r.data); }
    catch (e: any) { notify('خطأ', e?.response?.data?.detail || 'تعذر تحميل المجموعة'); }
    finally { setLoading(false); }
  }, [courseId, group]);
  useEffect(() => { load(); }, [load]);

  const move = async (studentId: string, target: string | null) => {
    try { await courseGroupsAPI.assign(String(courseId), [studentId], target); setMoveFor(null); load(); }
    catch (e: any) { notify('خطأ', e?.response?.data?.detail || 'فشل النقل'); }
  };

  if (loading && !data) return <View style={s.center}><ActivityIndicator size="large" color="#1a2540" /></View>;
  if (!data) return <View style={s.center}><Text style={{ color: '#c62828' }}>المجموعة غير موجودة</Text></View>;

  const color = groupColor(data.group.key, data.all_groups);
  const students = (data.students || []).filter((x: any) => !q.trim() || x.full_name.includes(q.trim()) || String(x.student_number).includes(q.trim()));
  const flagged = (data.students || []).filter((x: any) => ['warning', 'danger', 'deprived'].includes(x.status)).length;

  return (
    <SafeAreaView style={s.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 40 }} testID="course-group-page">
        <View style={[s.hero, { borderRightColor: color }]} testID="course-group-hero">
          <View style={{ flex: 1 }}>
            <Text style={s.heroTitle}>👥 {data.group.name}</Text>
            <Text style={s.heroSub}>{data.course.name}{data.course.code ? ` · ${data.course.code}` : ''} — {data.course.department_name} · م{data.course.level}{data.course.section ? ` / ${data.course.section}` : ''}</Text>
            <Text style={s.heroSub}>القائد: <Text style={s.b}>{data.group.teacher_name || 'مدرّس المقرر'}</Text> · الطلاب: <Text style={s.b}>{data.group.count}</Text> · المحاضرات: <Text style={s.b}>{data.lectures.total}</Text> (منفَّذة {data.lectures.completed || 0} · مجدولة {data.lectures.scheduled || 0} · ملغاة {data.lectures.cancelled || 0})</Text>
            {flagged > 0 && <Text style={[s.heroSub, { color: '#c62828' }]}>⚠️ {flagged} طالب تجاوز/اقترب من حدود الغياب</Text>}
          </View>
          <View style={{ gap: 6 }}>
            <TouchableOpacity onPress={() => router.push({ pathname: '/course-lectures', params: { courseId: String(courseId), group: String(group) } })} style={s.heroBtn} testID="course-group-lectures-btn"><Ionicons name="calendar-outline" size={14} color="#fff" /><Text style={s.heroBtnTxt}>محاضرات المجموعة</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => router.push({ pathname: '/course-students', params: { courseId: String(courseId) } })} style={[s.heroBtn, { backgroundColor: '#5b6678' }]} testID="course-group-students-btn"><Ionicons name="people-outline" size={14} color="#fff" /><Text style={s.heroBtnTxt}>كل طلاب المقرر</Text></TouchableOpacity>
          </View>
        </View>

        <View style={s.chips} testID="course-group-switcher">
          {data.all_groups.map((g: any) => (
            <TouchableOpacity key={g.key} onPress={() => g.key !== data.group.key && router.replace({ pathname: '/course-group', params: { courseId: String(courseId), group: g.key } })} style={[s.chip, { borderColor: groupColor(g.key, data.all_groups) }, g.key === data.group.key && { backgroundColor: groupColor(g.key, data.all_groups) }]} testID={`course-group-switch-${g.key}`}>
              <Text style={[s.chipTxt, g.key === data.group.key && { color: '#fff' }]}>{g.name} ({g.count})</Text>
            </TouchableOpacity>
          ))}
        </View>

        {data.schedule.length > 0 && (
          <View style={s.card} testID="course-group-schedule">
            <Text style={s.cardTitle}>الجدول الأسبوعي للمجموعة</Text>
            <View style={s.chips}>{data.schedule.map((c: any, i: number) => <View key={i} style={[s.chip, { borderColor: '#cbd5e1', backgroundColor: '#f8fafc' }]}><Text style={s.chipTxt}>{c.day} · فترة {c.slot_number}{c.start_time ? ` (${c.start_time}–${c.end_time})` : ''}{c.room ? ` · ${c.room}` : ''}</Text></View>)}</View>
          </View>
        )}

        <View style={s.card}>
          <Text style={s.cardTitle}>تصدير / استيراد</Text>
          <GroupsExcelBar courseId={String(courseId)} group={String(group)} course={data.course} onImported={load} />
        </View>

        <View style={s.card} testID="course-group-table">
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={s.cardTitle}>طلاب المجموعة ({students.length})</Text>
            <TextInput value={q} onChangeText={setQ} placeholder="بحث بالاسم / رقم القيد" style={s.search} testID="course-group-search" />
          </View>
          <View style={[s.tr, s.th]}>
            <Text style={[s.td, s.thTxt, { flex: 0.5 }]}>#</Text><Text style={[s.td, s.thTxt, { flex: 1.2 }]}>رقم القيد</Text><Text style={[s.td, s.thTxt, { flex: 3 }]}>الاسم</Text><Text style={[s.td, s.thTxt]}>م/ش</Text><Text style={[s.td, s.thTxt, { flex: 1.3 }]}>غياب بلا عذر</Text><Text style={[s.td, s.thTxt, { flex: 1.3 }]}>إجمالي الغياب</Text><Text style={[s.td, s.thTxt, { flex: 1.4 }]}>الحالة</Text><Text style={[s.td, s.thTxt, { flex: 1.2 }]}>نقل</Text>
          </View>
          {students.map((x: any, i: number) => (
            <View key={x.student_id} testID={`course-group-row-${x.student_number}`}>
              <View style={[s.tr, i % 2 ? { backgroundColor: '#fafbfc' } : null]}>
                <Text style={[s.td, { flex: 0.5 }]}>{i + 1}</Text>
                <Text style={[s.td, { flex: 1.2 }]}>{x.student_number}</Text>
                <TouchableOpacity style={{ flex: 3 }} onPress={() => router.push({ pathname: '/student-details', params: { studentId: x.student_id } })} testID={`course-group-open-${x.student_number}`}><Text style={[s.td, { color: '#1565c0', fontWeight: '700' }]}>{x.full_name}</Text></TouchableOpacity>
                <Text style={s.td}>{x.level}{x.section ? `/${x.section}` : ''}</Text>
                <Text style={[s.td, { flex: 1.3, color: x.pct_unexcused > data.limits.unexcused_limit ? '#c62828' : '#334155' }]}>{x.pct_unexcused}%</Text>
                <Text style={[s.td, { flex: 1.3, color: x.pct_total > data.limits.total_limit ? '#c62828' : '#334155' }]}>{x.pct_total}%</Text>
                <View style={{ flex: 1.4, alignItems: 'center' }}><View style={[s.pill, { backgroundColor: STATUS_COLOR[x.status] || '#64748b' }]}><Text style={s.pillTxt}>{x.status_ar || x.status}</Text></View></View>
                <TouchableOpacity style={{ flex: 1.2, alignItems: 'center' }} onPress={() => setMoveFor(moveFor === x.student_id ? null : x.student_id)} testID={`course-group-move-${x.student_number}`}><Ionicons name="swap-horizontal" size={18} color="#1565c0" /></TouchableOpacity>
              </View>
              {moveFor === x.student_id && (
                <View style={[s.chips, { padding: 8, backgroundColor: '#eef3f9' }]} testID={`course-group-move-options-${x.student_number}`}>
                  <Text style={s.chipTxt}>نقل إلى:</Text>
                  {data.all_groups.filter((g: any) => g.key !== data.group.key).map((g: any) => <TouchableOpacity key={g.key} onPress={() => move(x.student_id, g.key)} style={[s.chip, { borderColor: groupColor(g.key, data.all_groups) }]} testID={`course-group-move-${x.student_number}-to-${g.key}`}><Text style={s.chipTxt}>{g.name}</Text></TouchableOpacity>)}
                  <TouchableOpacity onPress={() => move(x.student_id, null)} style={[s.chip, { borderColor: '#9e9e9e' }]} testID={`course-group-unassign-${x.student_number}`}><Text style={s.chipTxt}>بلا مجموعة</Text></TouchableOpacity>
                </View>
              )}
            </View>
          ))}
          {students.length === 0 && <Text style={{ color: '#94a3b8', textAlign: 'center', padding: 16 }}>لا يوجد طلاب في هذه المجموعة</Text>}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hero: { flexDirection: 'row-reverse', gap: 12, backgroundColor: '#fff', borderRadius: 14, padding: 14, borderRightWidth: 6, borderWidth: 1, borderColor: '#e6eaf0', marginBottom: 10 },
  heroTitle: { fontSize: 18, fontWeight: '900', color: '#1a2540', textAlign: 'right' },
  heroSub: { fontSize: 12.5, color: '#5b6678', textAlign: 'right', marginTop: 4 },
  b: { fontWeight: '800', color: '#1a2540' },
  heroBtn: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, backgroundColor: '#1565c0', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  heroBtnTxt: { color: '#fff', fontSize: 12, fontWeight: '700' },
  chips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 8 },
  chip: { borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: '#fff' },
  chipTxt: { fontSize: 12, fontWeight: '700', color: '#1a2540' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#e6eaf0', marginBottom: 10 },
  cardTitle: { fontSize: 14, fontWeight: '800', color: '#1a2540', textAlign: 'right', marginBottom: 6 },
  search: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 12, width: 220, textAlign: 'right' },
  tr: { flexDirection: 'row-reverse', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  th: { backgroundColor: '#1a2540', borderRadius: 8 },
  td: { flex: 1, fontSize: 12.5, color: '#334155', textAlign: 'center' },
  thTxt: { color: '#fff', fontWeight: '800' },
  pill: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  pillTxt: { color: '#fff', fontSize: 11, fontWeight: '800' },
});
