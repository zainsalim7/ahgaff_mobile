import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Modal, ActivityIndicator, Platform, Alert, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { courseGroupsAPI, teachersAPI } from '../services/api';

export interface CourseGroup {
  key: string;
  name: string;
  teacher_id?: string | null;
  teacher_name?: string;
  count: number;
  students: Array<{ student_id: string; student_number: string; full_name: string }>;
}

export interface GroupsView {
  course_id: string;
  course_name: string;
  groups: CourseGroup[];
  unassigned: Array<{ student_id: string; student_number: string; full_name: string }>;
  total: number;
}

export const GROUP_COLORS = ['#1565c0', '#2e7d32', '#ad1457', '#ef6c00', '#6a1b9a', '#00838f', '#5d4037', '#c62828'];
export const groupColor = (key: string, groups: Array<{ key: string }>) => {
  const i = Math.max(0, groups.findIndex(g => g.key === key));
  return GROUP_COLORS[i % GROUP_COLORS.length];
};

const notify = (title: string, msg: string) => (Platform.OS === 'web' ? window.alert(`${title}\n${msg}`) : Alert.alert(title, msg));
const confirmAsk = (msg: string) => (Platform.OS === 'web' ? window.confirm(msg) : true);

interface Props {
  visible: boolean;
  courseId: string;
  onClose: () => void;
  /** يُستدعى بعد أي تغيير لتحديث الصفحة الأم */
  onChanged?: () => void;
}

export const CourseGroupsModal: React.FC<Props> = ({ visible, courseId, onClose, onChanged }) => {
  const [data, setData] = useState<GroupsView | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [teachers, setTeachers] = useState<Array<{ id: string; full_name: string }>>([]);
  const [draft, setDraft] = useState<Array<{ key: string; name: string; teacher_id: string }>>([]);
  const [autoCount, setAutoCount] = useState('2');
  const [autoMethod, setAutoMethod] = useState<'name' | 'number' | 'random'>('name');
  const [onlyUnassigned, setOnlyUnassigned] = useState(true);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [teacherPickFor, setTeacherPickFor] = useState<string | null>(null);
  const [teacherQuery, setTeacherQuery] = useState('');
  const [templates, setTemplates] = useState<any[]>([]);
  const [tplName, setTplName] = useState('');
  const [showTplSave, setShowTplSave] = useState(false);

  const loadTemplates = () => courseGroupsAPI.templates(courseId).then(r => setTemplates(r.data?.templates || [])).catch(() => setTemplates([]));

  const saveTemplate = async () => {
    if (!tplName.trim()) { notify('تنبيه', 'اكتب اسم القالب'); return; }
    setBusy(true);
    try {
      await courseGroupsAPI.saveTemplate(courseId, tplName.trim());
      setTplName(''); setShowTplSave(false);
      await loadTemplates();
      notify('تم', 'حُفظ التوزيع كقالب — يمكن تطبيقه على مقررات نفس القسم والمستوى');
    } catch (e: any) { notify('خطأ', e?.response?.data?.detail || 'فشل الحفظ'); }
    finally { setBusy(false); }
  };

  const applyTemplate = async (t: any) => {
    if (!confirmAsk(`تطبيق قالب «${t.name}» على هذا المقرر؟ سيُنشئ مجموعاته ويوزّع ${t.match_count} طالباً متطابقاً.`)) return;
    setBusy(true);
    try {
      const r = await courseGroupsAPI.applyTemplate(courseId, t.id);
      setData(r.data);
      setDraft((r.data.groups || []).map((g: CourseGroup) => ({ key: g.key, name: g.name, teacher_id: g.teacher_id || '' })));
      onChanged?.();
      notify('تم', r.data.message || 'طُبّق القالب');
    } catch (e: any) { notify('خطأ', e?.response?.data?.detail || 'فشل التطبيق'); }
    finally { setBusy(false); }
  };

  const deleteTemplate = async (t: any) => {
    if (!confirmAsk(`حذف القالب «${t.name}»؟`)) return;
    try { await courseGroupsAPI.deleteTemplate(t.id); await loadTemplates(); } catch { notify('خطأ', 'فشل الحذف'); }
  };

  const load = async () => {
    setLoading(true);
    try {
      const r = await courseGroupsAPI.get(courseId);
      setData(r.data);
      setDraft((r.data.groups || []).map((g: CourseGroup) => ({ key: g.key, name: g.name, teacher_id: g.teacher_id || '' })));
    } catch { notify('خطأ', 'فشل تحميل المجموعات'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (!visible || !courseId) return;
    load();
    loadTemplates();
    teachersAPI.getAll().then(r => setTeachers((r.data || []).map((t: any) => ({ id: t.id, full_name: t.full_name })))).catch(() => {});
  }, [visible, courseId]);

  const saveDraft = async (next = draft) => {
    setBusy(true);
    try {
      const r = await courseGroupsAPI.save(courseId, next.map(g => ({ key: g.key.trim(), name: g.name.trim(), teacher_id: g.teacher_id || null })));
      setData(r.data);
      if (r.data.schedule_sync_warnings?.length) notify('تنبيه الجدول الأسبوعي', r.data.schedule_sync_warnings.join('\n'));
      setDraft((r.data.groups || []).map((g: CourseGroup) => ({ key: g.key, name: g.name, teacher_id: g.teacher_id || '' })));
      onChanged?.();
    } catch (e: any) { notify('خطأ', e?.response?.data?.detail || 'فشل الحفظ'); }
    finally { setBusy(false); }
  };

  const addGroup = () => {
    let n = draft.length + 1;
    while (draft.some(g => g.key === String(n))) n++;
    setDraft([...draft, { key: String(n), name: `مجموعة ${n}`, teacher_id: '' }]);
  };

  const removeGroup = (key: string) => {
    const g = data?.groups.find(x => x.key === key);
    if (g && g.count > 0 && !confirmAsk(`حذف «${g.name}»؟ سيُزال ${g.count} طالب من المجموعة (يبقون مسجلين في المقرر).`)) return;
    saveDraft(draft.filter(x => x.key !== key));
  };

  const runAuto = async () => {
    const count = parseInt(autoCount, 10);
    if (!count || count < 2) { notify('تنبيه', 'عدد المجموعات يجب أن يكون 2 فأكثر'); return; }
    if (!onlyUnassigned && !confirmAsk(`إعادة توزيع كل الطلاب (${data?.total || 0}) على ${count} مجموعات؟ سيُلغى التوزيع الحالي.`)) return;
    setBusy(true);
    try {
      const r = await courseGroupsAPI.autoDistribute(courseId, { count, method: autoMethod, only_unassigned: onlyUnassigned });
      setData(r.data);
      setDraft((r.data.groups || []).map((g: CourseGroup) => ({ key: g.key, name: g.name, teacher_id: g.teacher_id || '' })));
      onChanged?.();
      notify('تم', r.data.message || 'تم التوزيع');
    } catch (e: any) { notify('خطأ', e?.response?.data?.detail || 'فشل التوزيع'); }
    finally { setBusy(false); }
  };

  const moveStudent = async (studentId: string, group: string | null) => {
    setBusy(true);
    try {
      await courseGroupsAPI.assign(courseId, [studentId], group);
      await load();
      onChanged?.();
    } catch (e: any) { notify('خطأ', e?.response?.data?.detail || 'فشل النقل'); }
    finally { setBusy(false); }
  };

  const dirty = JSON.stringify(draft) !== JSON.stringify((data?.groups || []).map(g => ({ key: g.key, name: g.name, teacher_id: g.teacher_id || '' })));
  const filteredTeachers = teachers.filter(t => !teacherQuery || t.full_name.includes(teacherQuery)).slice(0, 30);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={st.overlay}>
        <View style={st.card} testID="course-groups-modal">
          <View style={st.header}>
            <TouchableOpacity onPress={onClose} testID="course-groups-close"><Ionicons name="close" size={22} color="#5b6678" /></TouchableOpacity>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={st.title}>👥 المجموعات الدراسية</Text>
              <Text style={st.sub}>{data?.course_name || ''} · {data?.total ?? 0} طالب · غير موزّع: {data?.unassigned.length ?? 0}</Text>
            </View>
          </View>

          {loading ? <ActivityIndicator style={{ margin: 30 }} color="#1565c0" /> : (
            <ScrollView style={{ padding: 16 }} contentContainerStyle={{ paddingBottom: 24 }}>
              {/* التوزيع التلقائي */}
              <View style={st.box}>
                <Text style={st.boxTitle}>⚡ توزيع تلقائي</Text>
                <View style={st.rowR}>
                  <Text style={st.lbl}>عدد المجموعات</Text>
                  <TextInput value={autoCount} onChangeText={v => setAutoCount(v.replace(/[^0-9]/g, '').slice(0, 2))} keyboardType="number-pad" style={st.numInput} testID="groups-auto-count" />
                </View>
                <View style={[st.rowR, { flexWrap: 'wrap', gap: 6 }]}>
                  {([['name', 'بالاسم'], ['number', 'برقم القيد'], ['random', 'عشوائي']] as const).map(([v, l]) => (
                    <TouchableOpacity key={v} onPress={() => setAutoMethod(v)} style={[st.chip, autoMethod === v && st.chipOn]} testID={`groups-auto-method-${v}`}>
                      <Text style={[st.chipTxt, autoMethod === v && { color: '#fff' }]}>{l}</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity onPress={() => setOnlyUnassigned(!onlyUnassigned)} style={[st.chip, onlyUnassigned && { backgroundColor: '#e8f5e9', borderColor: '#2e7d32' }]} testID="groups-auto-only-unassigned">
                    <Ionicons name={onlyUnassigned ? 'checkbox' : 'square-outline'} size={14} color="#2e7d32" />
                    <Text style={[st.chipTxt, { color: '#2e7d32' }]}>غير الموزّعين فقط</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity onPress={runAuto} disabled={busy} style={[st.primaryBtn, busy && { opacity: 0.6 }]} testID="groups-auto-run">
                  <Ionicons name="shuffle" size={16} color="#fff" />
                  <Text style={st.primaryTxt}>توزيع الآن</Text>
                </TouchableOpacity>
              </View>

              {/* تعريف المجموعات */}
              <View style={st.box}>
                <View style={st.rowR}>
                  <TouchableOpacity onPress={addGroup} style={st.ghostBtn} testID="groups-add"><Ionicons name="add" size={16} color="#1565c0" /><Text style={st.ghostTxt}>إضافة مجموعة</Text></TouchableOpacity>
                  <Text style={st.boxTitle}>🏷️ المجموعات ومدرّسوها</Text>
                </View>
                {draft.length === 0 && <Text style={st.empty}>لا توجد مجموعات بعد — استخدم التوزيع التلقائي أو أضف مجموعة.</Text>}
                {draft.map((g, i) => {
                  const live = data?.groups.find(x => x.key === g.key);
                  const color = GROUP_COLORS[i % GROUP_COLORS.length];
                  const tName = teachers.find(t => t.id === g.teacher_id)?.full_name || live?.teacher_name || '';
                  return (
                    <View key={g.key} style={[st.groupRow, { borderRightColor: color }]} testID={`group-row-${g.key}`}>
                      <TouchableOpacity onPress={() => removeGroup(g.key)} testID={`group-remove-${g.key}`}><Ionicons name="trash-outline" size={18} color="#c62828" /></TouchableOpacity>
                      <TouchableOpacity onPress={() => { setTeacherPickFor(teacherPickFor === g.key ? null : g.key); setTeacherQuery(''); }} style={st.teacherBtn} testID={`group-teacher-${g.key}`}>
                        <Ionicons name="person-outline" size={13} color="#5b6678" />
                        <Text style={st.teacherTxt} numberOfLines={1}>{tName || 'مدرّس المقرر'}</Text>
                      </TouchableOpacity>
                      <TextInput value={g.name} onChangeText={v => setDraft(draft.map(x => x.key === g.key ? { ...x, name: v } : x))} style={st.nameInput} placeholder="اسم المجموعة" testID={`group-name-${g.key}`} />
                      <TouchableOpacity onPress={() => setOpenGroup(openGroup === g.key ? null : g.key)} style={[st.keyBadge, { backgroundColor: color }]} testID={`group-toggle-${g.key}`}>
                        <Text style={st.keyTxt}>{g.key}</Text>
                        <Text style={st.keyCount}>{live?.count ?? 0}</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
                {teacherPickFor && (
                  <View style={st.picker} testID="group-teacher-picker">
                    <TextInput value={teacherQuery} onChangeText={setTeacherQuery} placeholder="ابحث عن مدرّس..." style={st.search} />
                    <ScrollView style={{ maxHeight: 180 }}>
                      <TouchableOpacity style={st.pickRow} onPress={() => { setDraft(draft.map(x => x.key === teacherPickFor ? { ...x, teacher_id: '' } : x)); setTeacherPickFor(null); }}>
                        <Text style={[st.pickTxt, { color: '#5b6678' }]}>— مدرّس المقرر (بلا تخصيص)</Text>
                      </TouchableOpacity>
                      {filteredTeachers.map(t => (
                        <TouchableOpacity key={t.id} style={st.pickRow} onPress={() => { setDraft(draft.map(x => x.key === teacherPickFor ? { ...x, teacher_id: t.id } : x)); setTeacherPickFor(null); }} testID={`group-teacher-opt-${t.id}`}>
                          <Text style={st.pickTxt}>{t.full_name}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}
                {dirty && (
                  <TouchableOpacity onPress={() => saveDraft()} disabled={busy} style={[st.primaryBtn, { backgroundColor: '#2e7d32' }, busy && { opacity: 0.6 }]} testID="groups-save">
                    <Ionicons name="checkmark" size={16} color="#fff" />
                    <Text style={st.primaryTxt}>حفظ المجموعات</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* 📋 قوالب التوزيع */}
              <View style={st.box} testID="group-templates-box">
                <View style={st.rowR}>
                  <TouchableOpacity onPress={() => setShowTplSave(!showTplSave)} disabled={!data || data.groups.length === 0} style={[st.ghostBtn, (!data || data.groups.length === 0) && { opacity: 0.5 }]} testID="tpl-save-toggle">
                    <Ionicons name="bookmark-outline" size={16} color="#1565c0" />
                    <Text style={st.ghostTxt}>حفظ التوزيع الحالي كقالب</Text>
                  </TouchableOpacity>
                  <Text style={st.boxTitle}>📋 قوالب التوزيع</Text>
                </View>
                {showTplSave && (
                  <View style={[st.rowR, { marginBottom: 6 }]}>
                    <TouchableOpacity onPress={saveTemplate} disabled={busy} style={[st.primaryBtn, { marginTop: 0, paddingHorizontal: 14 }]} testID="tpl-save-btn">
                      <Text style={st.primaryTxt}>حفظ</Text>
                    </TouchableOpacity>
                    <TextInput value={tplName} onChangeText={setTplName} placeholder="اسم القالب (مثال: توزيع م3 عملي)" style={[st.nameInput, { flex: 1 }]} testID="tpl-name-input" />
                  </View>
                )}
                {templates.length === 0 ? (
                  <Text style={st.empty}>لا توجد قوالب لهذا القسم/المستوى بعد. وزّع الطلاب هنا ثم احفظ التوزيع كقالب لتطبيقه على المقررات الأخرى بضغطة.</Text>
                ) : templates.map(t => (
                  <View key={t.id} style={st.tplRow} testID={`tpl-row-${t.id}`}>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <TouchableOpacity onPress={() => applyTemplate(t)} disabled={busy || t.match_count === 0} style={[st.miniChip, { borderColor: '#2e7d32', backgroundColor: '#e8f5e9' }, (busy || t.match_count === 0) && { opacity: 0.5 }]} testID={`tpl-apply-${t.id}`}>
                        <Text style={{ fontSize: 11, color: '#2e7d32', fontWeight: '800' }}>تطبيق ({t.match_count})</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => deleteTemplate(t)} style={[st.miniChip, { borderColor: '#ef9a9a' }]} testID={`tpl-delete-${t.id}`}>
                        <Ionicons name="trash-outline" size={13} color="#c62828" />
                      </TouchableOpacity>
                    </View>
                    <View style={{ flex: 1, alignItems: 'flex-end' }}>
                      <Text style={{ fontSize: 13, fontWeight: '800', color: '#1a2540' }}>{t.name} {t.is_source ? '· (هذا المقرر)' : ''}</Text>
                      <Text style={{ fontSize: 11, color: '#5b6678' }}>{t.groups.length} مجموعات · {t.students_count} طالب · من «{t.source_course_name}»{t.same_section ? '' : ' · شعبة أخرى'}</Text>
                    </View>
                  </View>
                ))}
              </View>

              {/* طلاب المجموعة المفتوحة */}
              {openGroup && data && (() => {
                const g = data.groups.find(x => x.key === openGroup);
                if (!g) return null;
                return (
                  <View style={st.box} testID={`group-students-${g.key}`}>
                    <Text style={st.boxTitle}>{g.name} — {g.count} طالب</Text>
                    {g.students.map(s => (
                      <View key={s.student_id} style={st.stuRow}>
                        <View style={{ flexDirection: 'row', gap: 4 }}>
                          {data.groups.filter(x => x.key !== g.key).map(x => (
                            <TouchableOpacity key={x.key} onPress={() => moveStudent(s.student_id, x.key)} style={[st.miniChip, { borderColor: groupColor(x.key, data.groups) }]} testID={`move-${s.student_id}-to-${x.key}`}>
                              <Text style={{ fontSize: 11, color: groupColor(x.key, data.groups), fontWeight: '700' }}>→ {x.key}</Text>
                            </TouchableOpacity>
                          ))}
                          <TouchableOpacity onPress={() => moveStudent(s.student_id, null)} style={[st.miniChip, { borderColor: '#9e9e9e' }]} testID={`unassign-${s.student_id}`}>
                            <Text style={{ fontSize: 11, color: '#616161', fontWeight: '700' }}>إزالة</Text>
                          </TouchableOpacity>
                        </View>
                        <Text style={st.stuTxt} numberOfLines={1}>{s.full_name} <Text style={{ color: '#90a4ae' }}>({s.student_number})</Text></Text>
                      </View>
                    ))}
                  </View>
                );
              })()}

              {/* غير الموزّعين */}
              {data && data.unassigned.length > 0 && data.groups.length > 0 && (
                <View style={st.box} testID="group-unassigned">
                  <Text style={st.boxTitle}>⚠️ غير موزّعين — {data.unassigned.length}</Text>
                  {data.unassigned.map(s => (
                    <View key={s.student_id} style={st.stuRow}>
                      <View style={{ flexDirection: 'row', gap: 4 }}>
                        {data.groups.map(x => (
                          <TouchableOpacity key={x.key} onPress={() => moveStudent(s.student_id, x.key)} style={[st.miniChip, { borderColor: groupColor(x.key, data.groups) }]} testID={`assign-${s.student_id}-to-${x.key}`}>
                            <Text style={{ fontSize: 11, color: groupColor(x.key, data.groups), fontWeight: '700' }}>→ {x.key}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <Text style={st.stuTxt} numberOfLines={1}>{s.full_name} <Text style={{ color: '#90a4ae' }}>({s.student_number})</Text></Text>
                    </View>
                  ))}
                </View>
              )}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
};

const st = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(20,30,55,0.5)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  card: { backgroundColor: '#fff', borderRadius: 14, width: '100%', maxWidth: 640, maxHeight: '92%', overflow: 'hidden' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#eef1f6' },
  title: { fontSize: 17, fontWeight: '800', color: '#1a2540' },
  sub: { fontSize: 12, color: '#5b6678', marginTop: 2 },
  box: { backgroundColor: '#f8fafc', borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#eef1f6' },
  boxTitle: { fontSize: 14, fontWeight: '800', color: '#1a2540', textAlign: 'right', marginBottom: 8 },
  rowR: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 },
  lbl: { fontSize: 13, color: '#334155', fontWeight: '600' },
  numInput: { borderWidth: 1, borderColor: '#dfe5ee', borderRadius: 8, width: 70, paddingVertical: 6, textAlign: 'center', backgroundColor: '#fff', fontSize: 15, fontWeight: '700' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#dfe5ee' },
  chipOn: { backgroundColor: '#1565c0', borderColor: '#1565c0' },
  chipTxt: { fontSize: 12, fontWeight: '700', color: '#334155' },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#1565c0', paddingVertical: 10, borderRadius: 10, marginTop: 6 },
  primaryTxt: { color: '#fff', fontWeight: '800', fontSize: 13 },
  ghostBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: '#e3f2fd' },
  ghostTxt: { color: '#1565c0', fontWeight: '700', fontSize: 12 },
  empty: { fontSize: 12, color: '#90a4ae', textAlign: 'right' },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderRadius: 10, padding: 8, marginBottom: 6, borderRightWidth: 4, borderWidth: 1, borderColor: '#eef1f6' },
  keyBadge: { minWidth: 44, alignItems: 'center', borderRadius: 8, paddingVertical: 4, paddingHorizontal: 8 },
  keyTxt: { color: '#fff', fontWeight: '900', fontSize: 15 },
  keyCount: { color: '#fff', fontSize: 10, opacity: 0.9 },
  nameInput: { flex: 1, borderWidth: 1, borderColor: '#dfe5ee', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, textAlign: 'right', fontSize: 13 },
  teacherBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: '#dfe5ee', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 8, maxWidth: 160, backgroundColor: '#fafbfd' },
  teacherTxt: { fontSize: 12, color: '#334155', fontWeight: '600' },
  picker: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#dfe5ee', borderRadius: 10, padding: 8, marginBottom: 6 },
  search: { borderWidth: 1, borderColor: '#dfe5ee', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, textAlign: 'right', marginBottom: 6, fontSize: 13 },
  pickRow: { paddingVertical: 8, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#f3f5f9' },
  pickTxt: { fontSize: 13, color: '#1a2540', textAlign: 'right' },
  stuRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#eef1f6', gap: 8 },
  stuTxt: { flex: 1, fontSize: 13, color: '#1a2540', textAlign: 'right' },
  tplRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, backgroundColor: '#fff', borderRadius: 10, padding: 8, marginBottom: 6, borderWidth: 1, borderColor: '#eef1f6' },
  miniChip: { borderWidth: 1, borderRadius: 6, paddingVertical: 3, paddingHorizontal: 7, backgroundColor: '#fff' },
});
