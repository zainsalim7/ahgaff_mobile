import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { departmentsAPI, facultiesAPI } from '../services/api';

export type TargetFilter = { faculty_id: string; department_id: string; level: string; section: string };

type Props = { courses: any[]; current?: { department_id?: string; level?: number | string; section?: string } | null; onFiltered: (list: any[]) => void };

/** 🎯 فلاتر اختيار المقررات الهدف (نسخ/نقل الطلاب): الكلية → القسم → المستوى → الشعبة. الافتراضي: قسم ومستوى المقرر الحالي */
export const TargetCourseFilters: React.FC<Props> = ({ courses, current, onFiltered }) => {
  const [faculties, setFaculties] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [f, setF] = useState<TargetFilter>({ faculty_id: '', department_id: current?.department_id || '', level: current?.level ? String(current.level) : '', section: '' });

  useEffect(() => {
    facultiesAPI.getAll().then((r: any) => setFaculties(r.data || [])).catch(() => {});
    departmentsAPI.getAll().then((r: any) => setDepartments(r.data || [])).catch(() => {});
  }, []);
  useEffect(() => {
    if (!f.faculty_id && f.department_id) {
      const d = departments.find((x) => x.id === f.department_id);
      if (d?.faculty_id) setF((p) => ({ ...p, faculty_id: d.faculty_id }));
    }
  }, [departments]); // eslint-disable-line

  const depts = useMemo(() => departments.filter((d) => !f.faculty_id || d.faculty_id === f.faculty_id), [departments, f.faculty_id]);
  const deptIds = useMemo(() => new Set(depts.map((d) => d.id)), [depts]);
  const pool = useMemo(() => courses.filter((c) => (!f.faculty_id || deptIds.has(c.department_id)) && (!f.department_id || c.department_id === f.department_id)), [courses, f.faculty_id, f.department_id, deptIds]);
  const levels = useMemo(() => Array.from(new Set(pool.map((c) => String(c.level || '')).filter(Boolean))).sort((a, b) => Number(a) - Number(b)), [pool]);
  const sections = useMemo(() => Array.from(new Set(pool.filter((c) => !f.level || String(c.level) === f.level).map((c) => c.section || '').filter(Boolean))).sort(), [pool, f.level]);

  useEffect(() => {
    onFiltered(pool.filter((c) => (!f.level || String(c.level) === f.level) && (!f.section || (c.section || '') === f.section)));
  }, [pool, f.level, f.section]); // eslint-disable-line

  const Chips = ({ label, items, value, onPick, testPrefix }: { label: string; items: Array<{ id: string; name: string }>; value: string; onPick: (v: string) => void; testPrefix: string }) => (
    <View style={s.row}>
      <Text style={s.lbl}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row-reverse', gap: 5 }}>
        <TouchableOpacity onPress={() => onPick('')} style={[s.chip, !value && s.chipOn]} testID={`${testPrefix}-all`}><Text style={[s.chipTxt, !value && s.chipTxtOn]}>الكل</Text></TouchableOpacity>
        {items.map((it) => <TouchableOpacity key={it.id} onPress={() => onPick(it.id)} style={[s.chip, value === it.id && s.chipOn]} testID={`${testPrefix}-${it.id}`}><Text style={[s.chipTxt, value === it.id && s.chipTxtOn]} numberOfLines={1}>{it.name}</Text></TouchableOpacity>)}
      </ScrollView>
    </View>
  );

  return (
    <View style={s.box} testID="target-course-filters">
      <Chips label="الكلية" items={faculties.map((x) => ({ id: x.id, name: x.name }))} value={f.faculty_id} onPick={(v) => setF({ faculty_id: v, department_id: '', level: '', section: '' })} testPrefix="tf-faculty" />
      <Chips label="القسم" items={depts.map((x) => ({ id: x.id, name: x.name }))} value={f.department_id} onPick={(v) => setF({ ...f, department_id: v, level: '', section: '' })} testPrefix="tf-dept" />
      {levels.length > 0 && <Chips label="المستوى" items={levels.map((l) => ({ id: l, name: `م${l}` }))} value={f.level} onPick={(v) => setF({ ...f, level: v, section: '' })} testPrefix="tf-level" />}
      {sections.length > 0 && <Chips label="الشعبة" items={sections.map((x) => ({ id: x, name: x }))} value={f.section} onPick={(v) => setF({ ...f, section: v })} testPrefix="tf-section" />}
    </View>
  );
};

const s = StyleSheet.create({
  box: { backgroundColor: '#f8fafc', borderRadius: 10, padding: 8, marginBottom: 8, gap: 6, borderWidth: 1, borderColor: '#e2e8f0' },
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  lbl: { fontSize: 11, fontWeight: '800', color: '#5b6678', width: 46, textAlign: 'right' },
  chip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#d1d5db', maxWidth: 160 },
  chipOn: { backgroundColor: '#1a2540', borderColor: '#1a2540' },
  chipTxt: { fontSize: 11, fontWeight: '700', color: '#334155' },
  chipTxtOn: { color: '#fff' },
});
