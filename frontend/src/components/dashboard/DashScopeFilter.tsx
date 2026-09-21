import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
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

export const DashScopeFilter = ({ faculties, departments, facultyId, departmentId, onChange }: Props) => {
  const showFaculties = faculties.length > 1;
  const depts = facultyId ? departments.filter((d) => d.faculty_id === facultyId) : departments;
  return (
    <View style={styles.wrap} testID="dash-scope-filter">
      {showFaculties && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowRev}>
          <Ionicons name="business" size={14} color={DASH.muted} style={{ marginLeft: 6 }} />
          <TouchableOpacity style={[styles.pill, !facultyId && styles.pillOn]} onPress={() => onChange('', '')} testID="dash-fac-all">
            <Text style={[styles.pillText, !facultyId && styles.pillTextOn]}>كل الكليات</Text>
          </TouchableOpacity>
          {faculties.map((f) => (
            <TouchableOpacity key={f.id} style={[styles.pill, facultyId === f.id && styles.pillOn]} onPress={() => onChange(f.id, '')} testID={`dash-fac-${f.id}`}>
              <Text style={[styles.pillText, facultyId === f.id && styles.pillTextOn]}>{f.name.trim()}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
      {depts.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowRev}>
          <Ionicons name="git-branch-outline" size={14} color={DASH.muted} style={{ marginLeft: 6 }} />
          <TouchableOpacity style={[styles.pill, styles.pillDept, !departmentId && styles.pillDeptOn]} onPress={() => onChange(facultyId, '')} testID="dash-dept-all">
            <Text style={[styles.pillText, !departmentId && styles.pillTextOn]}>كل الأقسام</Text>
          </TouchableOpacity>
          {depts.map((d) => (
            <TouchableOpacity key={d.id} style={[styles.pill, styles.pillDept, departmentId === d.id && styles.pillDeptOn]} onPress={() => onChange(facultyId, d.id)} testID={`dash-dept-${d.id}`}>
              <Text style={[styles.pillText, departmentId === d.id && styles.pillTextOn]}>{d.name.trim()}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { gap: 8, marginBottom: 16 },
  rowRev: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, paddingHorizontal: 2 },
  pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: DASH.line },
  pillOn: { backgroundColor: DASH.navy, borderColor: DASH.navy },
  pillDept: { borderStyle: 'dashed' },
  pillDeptOn: { backgroundColor: DASH.blue, borderColor: DASH.blue, borderStyle: 'solid' },
  pillText: { fontSize: 12, fontWeight: '700', color: '#334155' },
  pillTextOn: { color: '#fff' },
});
