import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView, Pressable, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DASH } from './dashTheme';

interface Fac { id: string; name: string }
interface Dept { id: string; name: string; faculty_id?: string }
interface Props {
  faculties: Fac[];
  departments: Dept[];
  facultyId: string;
  departmentId: string;
  onChange: (facultyId: string, departmentId: string) => void;
}

/** 🔽 قائمة منسدلة للنطاق: كل كلية مع أقسامها تحتها (اختيار الكلية كلها أو قسم واحد) */
export const DashScopeFilter = ({ faculties, departments, facultyId, departmentId, onChange }: Props) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => {
    const list = faculties.length
      ? faculties.map((f) => ({ ...f, depts: departments.filter((d) => d.faculty_id === f.id) }))
      : [{ id: '', name: 'الأقسام', depts: departments }];
    const orphan = departments.filter((d) => !faculties.some((f) => f.id === d.faculty_id));
    if (faculties.length && orphan.length) list.push({ id: '__other__', name: 'أقسام بلا كلية', depts: orphan });
    const n = q.trim();
    if (!n) return list;
    return list
      .map((g) => ({ ...g, depts: g.depts.filter((d) => d.name.includes(n)) }))
      .filter((g) => g.name.includes(n) || g.depts.length);
  }, [faculties, departments, q]);

  const label = departmentId
    ? departments.find((d) => d.id === departmentId)?.name.trim() || 'قسم'
    : facultyId
    ? faculties.find((f) => f.id === facultyId)?.name.trim() || 'كلية'
    : faculties.length > 1 ? 'كل الكليات والأقسام' : 'كل الأقسام';

  const pick = (f: string, d: string) => { onChange(f, d); setOpen(false); setQ(''); };
  const isExpanded = (id: string) => expanded[id] ?? (!!q || id === facultyId || groups.length === 1);

  return (
    <View style={styles.wrap} testID="dash-scope-filter">
      <TouchableOpacity style={styles.trigger} onPress={() => setOpen(true)} activeOpacity={0.8} testID="dash-scope-dropdown">
        <Ionicons name="chevron-down" size={16} color={DASH.navy} />
        <Text style={styles.triggerText} numberOfLines={1} testID="dash-scope-dropdown-label">{label}</Text>
        <View style={styles.triggerIcon}><Ionicons name={departmentId ? 'git-branch-outline' : 'business'} size={15} color={DASH.gold} /></View>
      </TouchableOpacity>
      {(facultyId || departmentId) && (
        <TouchableOpacity style={styles.clear} onPress={() => pick('', '')} testID="dash-scope-clear">
          <Ionicons name="close" size={13} color={DASH.red} />
          <Text style={styles.clearText}>إزالة الفلتر</Text>
        </TouchableOpacity>
      )}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.overlay} onPress={() => setOpen(false)} testID="dash-scope-overlay">
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHead}>
              <TouchableOpacity onPress={() => setOpen(false)} testID="dash-scope-close"><Ionicons name="close" size={20} color={DASH.muted} /></TouchableOpacity>
              <Text style={styles.sheetTitle}>اختر النطاق</Text>
            </View>
            <View style={styles.search}>
              <Ionicons name="search" size={15} color="#94a3b8" />
              <TextInput value={q} onChangeText={setQ} placeholder="ابحث عن كلية أو قسم…" placeholderTextColor="#94a3b8" style={styles.searchInput} testID="dash-scope-search" />
            </View>
            <ScrollView style={{ maxHeight: 440 }}>
              <TouchableOpacity style={[styles.row, !facultyId && !departmentId && styles.rowOn]} onPress={() => pick('', '')} testID="dash-fac-all">
                <Ionicons name="globe-outline" size={16} color={!facultyId && !departmentId ? '#fff' : DASH.navy} />
                <Text style={[styles.rowText, !facultyId && !departmentId && styles.rowTextOn]}>{faculties.length > 1 ? 'كل الكليات والأقسام' : 'كل الأقسام'}</Text>
              </TouchableOpacity>
              {groups.map((g) => {
                const facOn = facultyId === g.id && !departmentId;
                const exp = isExpanded(g.id);
                return (
                  <View key={g.id || 'depts'} style={styles.group}>
                    <View style={styles.groupHead}>
                      <TouchableOpacity style={styles.expandBtn} onPress={() => setExpanded((e) => ({ ...e, [g.id]: !exp }))} testID={`dash-fac-expand-${g.id}`}>
                        <Ionicons name={exp ? 'chevron-up' : 'chevron-down'} size={16} color={DASH.muted} />
                        <Text style={styles.count}>{g.depts.length}</Text>
                      </TouchableOpacity>
                      {g.id && g.id !== '__other__' ? (
                        <TouchableOpacity style={[styles.facRow, facOn && styles.rowOn]} onPress={() => pick(g.id, '')} testID={`dash-fac-${g.id}`}>
                          <Ionicons name="business" size={15} color={facOn ? '#fff' : DASH.gold} />
                          <Text style={[styles.facText, facOn && styles.rowTextOn]} numberOfLines={1}>{g.name.trim()}</Text>
                          {!facOn && <Text style={styles.facHint}>الكلية كاملة</Text>}
                        </TouchableOpacity>
                      ) : (
                        <View style={styles.facRow}><Text style={styles.facText}>{g.name}</Text></View>
                      )}
                    </View>
                    {exp && g.depts.map((d) => {
                      const on = departmentId === d.id;
                      return (
                        <TouchableOpacity key={d.id} style={[styles.deptRow, on && styles.deptOn]} onPress={() => pick(g.id && g.id !== '__other__' ? g.id : '', d.id)} testID={`dash-dept-${d.id}`}>
                          <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={15} color={on ? DASH.blue : '#cbd5e1'} />
                          <Text style={[styles.deptText, on && { color: DASH.blue, fontWeight: '800' }]} numberOfLines={1}>{d.name.trim()}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                );
              })}
              {groups.length === 0 && <Text style={styles.noRes}>لا نتائج</Text>}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' },
  trigger: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: DASH.line, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 12, minWidth: 260, maxWidth: 420 },
  triggerIcon: { width: 28, height: 28, borderRadius: 8, backgroundColor: DASH.navy, alignItems: 'center', justifyContent: 'center' },
  triggerText: { flex: 1, fontSize: 13, fontWeight: '800', color: DASH.ink, textAlign: 'right' },
  clear: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca' },
  clearText: { fontSize: 11, color: DASH.red, fontWeight: '700' },
  overlay: { flex: 1, backgroundColor: 'rgba(15,36,64,0.45)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  sheet: { width: '100%', maxWidth: 520, backgroundColor: '#fff', borderRadius: 18, padding: 14, maxHeight: '90%' },
  sheetHead: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sheetTitle: { fontSize: 16, fontWeight: '800', color: DASH.ink },
  search: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, backgroundColor: '#f1f5f9', borderRadius: 10, paddingHorizontal: 10, marginBottom: 10 },
  searchInput: { flex: 1, paddingVertical: 8, fontSize: 13, textAlign: 'right', color: DASH.ink },
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, padding: 10, borderRadius: 10, marginBottom: 6 },
  rowOn: { backgroundColor: DASH.navy },
  rowText: { fontSize: 13, fontWeight: '800', color: DASH.ink },
  rowTextOn: { color: '#fff' },
  group: { borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 6, marginBottom: 4 },
  groupHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  facRow: { flex: 1, flexDirection: 'row-reverse', alignItems: 'center', gap: 8, padding: 9, borderRadius: 10 },
  facText: { flex: 1, fontSize: 13, fontWeight: '800', color: DASH.ink, textAlign: 'right' },
  facHint: { fontSize: 10, color: DASH.muted },
  expandBtn: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 8 },
  count: { fontSize: 11, color: DASH.muted, fontWeight: '700' },
  deptRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, paddingVertical: 8, paddingRight: 34, paddingLeft: 10, borderRadius: 8 },
  deptOn: { backgroundColor: '#eff6ff' },
  deptText: { flex: 1, fontSize: 12.5, color: '#334155', textAlign: 'right' },
  noRes: { textAlign: 'center', color: '#94a3b8', padding: 16 },
});
