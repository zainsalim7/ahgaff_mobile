/**
 * نظام الدرجات: استيراد كشوفات الإكسل + السجل الأكاديمي + بيان حالة ودرجات PDF
 */
import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Platform, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import api from '../src/services/api';
import { departmentsAPI, facultiesAPI } from '../src/services/api';

const TERM_AR: any = { 1: 'الأول', 2: 'الثاني', 3: 'الصيفي' };

export default function GradesScreen() {
  const [tab, setTab] = useState<'import' | 'record' | 'imports'>('import');
  const [faculties, setFaculties] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<any>(null);

  // استيراد
  const [facultyId, setFacultyId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [level, setLevel] = useState('4');
  const [semesterNo, setSemesterNo] = useState('1');
  const [academicYear, setAcademicYear] = useState('2025-2026');
  const [batchNo, setBatchNo] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any>(null);

  // السجل
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [record, setRecord] = useState<any[] | null>(null);
  const [stmtModal, setStmtModal] = useState(false);
  const [addressee, setAddressee] = useState('إلى من يهمه الأمر');
  const [statusText, setStatusText] = useState('');
  const [selectedRecs, setSelectedRecs] = useState<string[]>([]);

  // الاستيرادات
  const [imports, setImports] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const [f, d] = await Promise.all([facultiesAPI.getAll(), departmentsAPI.getAll()]);
        setFaculties(f.data || []);
        setDepartments(d.data || []);
        if ((f.data || []).length) setFacultyId(f.data[0].id);
      } catch { /* تجاهل */ }
    })();
  }, []);

  const showMsg = (type: string, text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 6000);
  };

  const filteredDepts = facultyId ? departments.filter((d) => d.faculty_id === facultyId) : departments;

  const doImport = async (commit: boolean) => {
    if (!file) { showMsg('error', '❌ اختر ملف الإكسل أولاً'); return; }
    if (!departmentId) { showMsg('error', '❌ اختر القسم'); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('faculty_id', facultyId);
      fd.append('department_id', departmentId);
      fd.append('level', level);
      fd.append('semester_no', semesterNo);
      fd.append('academic_year', academicYear);
      fd.append('batch_no', batchNo);
      fd.append('commit', commit ? 'true' : 'false');
      const res = await api.post('/grades/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      if (commit) {
        showMsg('success', res.data?.message || '✅ تم الاعتماد');
        setPreview(null);
        setFile(null);
      } else {
        setPreview(res.data);
      }
    } catch (e: any) {
      showMsg('error', `❌ ${e.response?.data?.detail || 'فشل في المعالجة'}`);
    } finally { setBusy(false); }
  };

  const doSearch = async (q: string) => {
    setSearch(q);
    if (q.trim().length < 2) { setResults([]); return; }
    try {
      const res = await api.get('/grades/search', { params: { q } });
      setResults(res.data || []);
    } catch { setResults([]); }
  };

  const openRecord = async (item: any) => {
    setBusy(true);
    try {
      const params: any = item.student_db_id ? { student_db_id: item.student_db_id } : { reg_no: item.reg_no };
      const res = await api.get('/grades/record', { params });
      setRecord(res.data || []);
      setSelectedRecs((res.data || []).map((r: any) => r.id));
      setResults([]);
    } catch { showMsg('error', '❌ فشل في جلب السجل'); }
    finally { setBusy(false); }
  };

  const issueStatement = async () => {
    if (!selectedRecs.length) { showMsg('error', '❌ اختر فصلاً واحداً على الأقل'); return; }
    setBusy(true);
    try {
      const res = await api.post('/grades/statement', {
        record_ids: selectedRecs,
        addressee,
        status_text: statusText,
        base_url: Platform.OS === 'web' ? window.location.origin : '',
      }, { responseType: 'blob' });
      if (Platform.OS === 'web') {
        const url = window.URL.createObjectURL(new Blob([res.data]));
        const a = document.createElement('a');
        a.href = url;
        a.download = `grade_statement_${record?.[0]?.reg_no || 'student'}.pdf`;
        a.click();
        window.URL.revokeObjectURL(url);
      }
      showMsg('success', '✅ تم إصدار البيان وتنزيله');
      setStmtModal(false);
    } catch (e: any) { showMsg('error', '❌ فشل في إصدار البيان'); }
    finally { setBusy(false); }
  };

  const loadImports = async () => {
    try {
      const res = await api.get('/grades/imports');
      setImports(res.data || []);
    } catch { setImports([]); }
  };

  const deleteImport = async (id: string, name: string) => {
    if (!window.confirm(`حذف استيراد «${name}» وكل سجلات درجاته؟`)) return;
    setBusy(true);
    try {
      const res = await api.delete(`/grades/imports/${id}`);
      showMsg('success', `✅ ${res.data?.message}`);
      await loadImports();
    } catch { showMsg('error', '❌ فشل الحذف'); }
    finally { setBusy(false); }
  };

  useEffect(() => { if (tab === 'imports') loadImports(); }, [tab]);

  const matchBadge = (t: string) => t === 'reg'
    ? { txt: 'مطابق بالقيد', bg: '#e8f5e9', col: '#2e7d32' }
    : t === 'name'
      ? { txt: 'مطابق بالاسم', bg: '#fff8e1', col: '#f57f17' }
      : { txt: 'غير مطابق', bg: '#ffebee', col: '#c62828' };

  return (
    <SafeAreaView style={st.container}>
      <View style={st.header}>
        <TouchableOpacity onPress={() => router.back()} testID="grades-back-btn">
          <Ionicons name="arrow-forward" size={24} color="#1a2540" />
        </TouchableOpacity>
        <Text style={st.title}>نظام الدرجات وبيانات الطلاب</Text>
        <View style={{ width: 24 }} />
      </View>

      {msg && (
        <View style={[st.msg, { backgroundColor: msg.type === 'success' ? '#e8f5e9' : '#ffebee' }]}>
          <Text style={{ color: msg.type === 'success' ? '#2e7d32' : '#c62828', fontSize: 13, textAlign: 'right' }}>{msg.text}</Text>
        </View>
      )}

      <View style={st.tabs}>
        {[
          { k: 'import', t: 'استيراد كشف درجات', ic: 'cloud-upload' },
          { k: 'record', t: 'سجل الطالب وبيانه', ic: 'school' },
          { k: 'imports', t: 'الاستيرادات', ic: 'list' },
        ].map((x: any) => (
          <TouchableOpacity key={x.k} style={[st.tab, tab === x.k && st.tabActive]} onPress={() => setTab(x.k)} testID={`grades-tab-${x.k}`}>
            <Ionicons name={x.ic} size={15} color={tab === x.k ? '#fff' : '#556'} />
            <Text style={[st.tabTxt, tab === x.k && { color: '#fff' }]}>{x.t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, paddingBottom: 60 }}>
        {tab === 'import' && (
          <View>
            <View style={st.card}>
              <Text style={st.label}>الكلية</Text>
              {Platform.OS === 'web' && (
                <select value={facultyId} onChange={(e: any) => { setFacultyId(e.target.value); setDepartmentId(''); }} style={sel as any} data-testid="grades-faculty-select">
                  {faculties.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              )}
              <Text style={st.label}>القسم / التخصص</Text>
              {Platform.OS === 'web' && (
                <select value={departmentId} onChange={(e: any) => setDepartmentId(e.target.value)} style={sel as any} data-testid="grades-dept-select">
                  <option value="">-- اختر القسم --</option>
                  {filteredDepts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              )}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={st.label}>المستوى</Text>
                  <TextInput style={st.input} value={level} onChangeText={setLevel} keyboardType="numeric" testID="grades-level-input" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={st.label}>الفصل (1/2)</Text>
                  <TextInput style={st.input} value={semesterNo} onChangeText={setSemesterNo} keyboardType="numeric" testID="grades-semester-input" />
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={st.label}>العام الجامعي</Text>
                  <TextInput style={st.input} value={academicYear} onChangeText={setAcademicYear} placeholder="2025-2026" testID="grades-year-input" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={st.label}>الدفعة (اختياري)</Text>
                  <TextInput style={st.input} value={batchNo} onChangeText={setBatchNo} testID="grades-batch-input" />
                </View>
              </View>
              <Text style={st.label}>ملف الإكسل (.xls / .xlsx)</Text>
              {Platform.OS === 'web' && (
                <input type="file" accept=".xls,.xlsx" onChange={(e: any) => setFile(e.target.files?.[0] || null)} data-testid="grades-file-input" style={{ marginBottom: 10, fontSize: 13 }} />
              )}
              <TouchableOpacity style={[st.btn, { backgroundColor: '#1565c0' }]} onPress={() => doImport(false)} disabled={busy} testID="grades-preview-btn">
                {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={st.btnTxt}>🔍 معاينة قبل الاعتماد</Text>}
              </TouchableOpacity>
            </View>

            {preview && (
              <View style={st.card}>
                <Text style={st.sectionTitle}>نتيجة المعاينة — {preview.stats.total} طالب · {preview.courses.length} مقرر</Text>
                {preview.already_imported && (
                  <Text style={{ color: '#c62828', fontSize: 12, textAlign: 'right', marginBottom: 6 }}>⚠️ يوجد استيراد سابق لنفس (القسم/المستوى/الفصل/العام) — الاعتماد سيضيف نسخة إضافية</Text>
                )}
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                  <Text style={[st.stat, { backgroundColor: '#e8f5e9', color: '#2e7d32' }]}>بالقيد: {preview.stats.matched_by_reg}</Text>
                  <Text style={[st.stat, { backgroundColor: '#fff8e1', color: '#f57f17' }]}>بالاسم: {preview.stats.matched_by_name}</Text>
                  <Text style={[st.stat, { backgroundColor: '#ffebee', color: '#c62828' }]}>غير مطابق: {preview.stats.unmatched}</Text>
                </View>
                <Text style={{ fontSize: 12, color: '#667', textAlign: 'right', marginBottom: 8 }}>
                  المقررات: {preview.courses.map((c: any) => `${c.name} (${c.credits})`).join('، ')}
                </Text>
                {preview.students.slice(0, 60).map((s: any, i: number) => {
                  const b = matchBadge(s.match_type);
                  return (
                    <View key={i} style={st.previewRow} testID={`grades-preview-row-${i}`}>
                      <Text style={[st.badge, { backgroundColor: b.bg, color: b.col }]}>{b.txt}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 12.5, fontWeight: '700', color: '#333', textAlign: 'right' }}>{s.name} <Text style={{ color: '#999', fontWeight: '400' }}>({s.reg_no})</Text></Text>
                        <Text style={{ fontSize: 10.5, color: '#888', textAlign: 'right' }} numberOfLines={1}>
                          {s.grades.map((g: any) => `${g.course_name}: ${g.total || '—'}`).join(' · ')}
                        </Text>
                        {!!s.result && <Text style={{ fontSize: 10.5, color: '#1565c0', textAlign: 'right' }}>النتيجة: {s.result} {s.note ? `— ${s.note}` : ''}</Text>}
                      </View>
                    </View>
                  );
                })}
                <TouchableOpacity style={[st.btn, { backgroundColor: '#2e7d32', marginTop: 10 }]} onPress={() => doImport(true)} disabled={busy} testID="grades-commit-btn">
                  {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={st.btnTxt}>✅ اعتماد الاستيراد وحفظ الدرجات</Text>}
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {tab === 'record' && (
          <View>
            <View style={st.card}>
              <Text style={st.label}>ابحث عن طالب (اسم أو رقم قيد)</Text>
              <TextInput style={st.input} value={search} onChangeText={doSearch} placeholder="اكتب اسم الطالب..." testID="grades-search-input" />
              {results.map((r: any, i: number) => (
                <TouchableOpacity key={i} style={st.resultRow} onPress={() => openRecord(r)} testID={`grades-result-${i}`}>
                  <Ionicons name="chevron-back" size={16} color="#999" />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#333', textAlign: 'right' }}>{r.student_name}</Text>
                    <Text style={{ fontSize: 11, color: '#888', textAlign: 'right' }}>قيد: {r.reg_no} · {r.semesters} فصل</Text>
                  </View>
                  <View style={st.avatar}><Ionicons name="person" size={14} color="#fff" /></View>
                </TouchableOpacity>
              ))}
            </View>

            {record && record.length > 0 && (
              <View style={st.card}>
                <Text style={st.sectionTitle}>📚 السجل الأكاديمي: {record[0].student_name} ({record[0].reg_no})</Text>
                {record.map((rc: any) => (
                  <View key={rc.id} style={st.semCard} testID={`grades-sem-${rc.id}`}>
                    <TouchableOpacity
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}
                      onPress={() => setSelectedRecs((p) => p.includes(rc.id) ? p.filter((x) => x !== rc.id) : [...p, rc.id])}
                      testID={`grades-sem-toggle-${rc.id}`}
                    >
                      <Ionicons name={selectedRecs.includes(rc.id) ? 'checkbox' : 'square-outline'} size={18} color="#2e7d32" />
                      <Text style={{ fontSize: 13, fontWeight: '800', color: '#1a2540', flex: 1, textAlign: 'right' }}>
                        الفصل {TERM_AR[rc.semester_no] || rc.semester_no} — المستوى {rc.level} — {rc.academic_year}
                        {rc.result ? `  |  النتيجة: ${rc.result}` : ''}
                      </Text>
                    </TouchableOpacity>
                    {rc.grades.map((g: any, gi: number) => (
                      <View key={gi} style={st.gradeRow}>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: g.total === '' ? '#999' : '#1565c0', width: 46, textAlign: 'center' }}>{g.total || '—'}</Text>
                        <Text style={{ fontSize: 11, color: '#999', width: 34, textAlign: 'center' }}>{g.credits}</Text>
                        <Text style={{ fontSize: 12, color: '#333', flex: 1, textAlign: 'right' }}>{g.course_name}</Text>
                      </View>
                    ))}
                    {!!rc.note && <Text style={{ fontSize: 11, color: '#a05', textAlign: 'right', marginTop: 4 }}>📌 {rc.note}</Text>}
                  </View>
                ))}
                <TouchableOpacity style={[st.btn, { backgroundColor: '#00695c' }]} onPress={() => setStmtModal(true)} testID="grades-issue-statement-btn">
                  <Text style={st.btnTxt}>📄 إصدار بيان حالة ودرجات ({selectedRecs.length} فصل)</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {tab === 'imports' && (
          <View style={st.card}>
            <Text style={st.sectionTitle}>الاستيرادات السابقة ({imports.length})</Text>
            {imports.map((im: any) => (
              <View key={im.id} style={st.importRow} testID={`grades-import-${im.id}`}>
                <TouchableOpacity onPress={() => deleteImport(im.id, im.filename)} testID={`grades-import-del-${im.id}`}>
                  <Ionicons name="trash" size={18} color="#c62828" />
                </TouchableOpacity>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12.5, fontWeight: '700', color: '#333', textAlign: 'right' }}>{im.filename}</Text>
                  <Text style={{ fontSize: 11, color: '#888', textAlign: 'right' }}>
                    {im.department_name} · م{im.level} · فصل {im.semester_no} · {im.academic_year} — {im.students_count} طالب / {im.courses_count} مقرر
                  </Text>
                  <Text style={{ fontSize: 10, color: '#aab', textAlign: 'right' }}>بواسطة {im.imported_by} في {im.imported_at}</Text>
                </View>
              </View>
            ))}
            {!imports.length && <Text style={{ textAlign: 'center', color: '#999', padding: 20, fontSize: 13 }}>لا توجد استيرادات بعد</Text>}
          </View>
        )}
      </ScrollView>

      {/* نموذج إصدار البيان */}
      {stmtModal && Platform.OS === 'web' && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => !busy && setStmtModal(false)}>
          <div onClick={(ev: any) => ev.stopPropagation()} data-testid="grade-statement-modal" style={{ backgroundColor: '#fff', borderRadius: 12, padding: 20, width: 560, maxWidth: '94%', direction: 'rtl', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#1a2540', marginBottom: 10, textAlign: 'right' }}>📄 إصدار بيان حالة ودرجات</div>
            <div style={{ fontSize: 12, color: '#667', marginBottom: 4, textAlign: 'right' }}>الجهة الموجَّه إليها:</div>
            <input value={addressee} onChange={(ev: any) => setAddressee(ev.target.value)} data-testid="statement-addressee-input"
              style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, direction: 'rtl', boxSizing: 'border-box', marginBottom: 10 }} />
            <div style={{ fontSize: 12, color: '#667', marginBottom: 4, textAlign: 'right' }}>نص الحالة (يظهر قبل الجداول — مثال: المذكور أعلاه من الدفعة (29)... وقد رسب... ونظراً لتحوله...):</div>
            <textarea value={statusText} onChange={(ev: any) => setStatusText(ev.target.value)} rows={5} data-testid="statement-status-input"
              style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, direction: 'rtl', boxSizing: 'border-box', marginBottom: 10, resize: 'vertical' }} />
            <div style={{ fontSize: 11.5, color: '#1565c0', backgroundColor: '#e3f2fd', borderRadius: 8, padding: '6px 10px', marginBottom: 12, textAlign: 'right' }}>
              سيتضمن البيان {selectedRecs.length} فصلاً دراسياً + رمز QR للتحقق العام
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={issueStatement} disabled={busy} data-testid="statement-generate-btn"
                style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: 'none', cursor: 'pointer', backgroundColor: '#00695c', color: '#fff', fontSize: 13.5, fontWeight: 700 }}>
                {busy ? 'جاري الإصدار...' : '📄 توليد وتنزيل PDF'}
              </button>
              <button onClick={() => setStmtModal(false)} disabled={busy} data-testid="statement-cancel-btn"
                style={{ flex: 0.5, padding: '10px 0', borderRadius: 8, border: '1px solid #ddd', cursor: 'pointer', backgroundColor: '#fff', color: '#555', fontSize: 13 }}>إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </SafeAreaView>
  );
}

const sel = { width: '100%', padding: '9px 10px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, direction: 'rtl', marginBottom: 10, backgroundColor: '#f7f9fc' };

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f2f4f8' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e5e9f0' },
  title: { fontSize: 16, fontWeight: '800', color: '#1a2540' },
  msg: { margin: 10, padding: 10, borderRadius: 8 },
  tabs: { flexDirection: 'row', gap: 6, padding: 10, backgroundColor: '#fff' },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 9, borderRadius: 8, backgroundColor: '#eef1f6' },
  tabActive: { backgroundColor: '#1a2540' },
  tabTxt: { fontSize: 11.5, fontWeight: '700', color: '#556' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 12 },
  label: { fontSize: 12, fontWeight: '700', color: '#556', marginBottom: 5, textAlign: 'right' },
  input: { backgroundColor: '#f7f9fc', borderRadius: 8, borderWidth: 1, borderColor: '#e0e4ea', padding: 9, fontSize: 13, textAlign: 'right', marginBottom: 10, color: '#333' },
  btn: { paddingVertical: 11, borderRadius: 8, alignItems: 'center' },
  btnTxt: { color: '#fff', fontSize: 13.5, fontWeight: '700' },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: '#1a2540', marginBottom: 10, textAlign: 'right' },
  stat: { fontSize: 11.5, fontWeight: '700', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, overflow: 'hidden' },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#f2f4f8' },
  badge: { fontSize: 10, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: 'hidden' },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 8, backgroundColor: '#f7f9fc', marginBottom: 6 },
  avatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#00695c', justifyContent: 'center', alignItems: 'center' },
  semCard: { borderWidth: 1, borderColor: '#e5e9f0', borderRadius: 10, padding: 10, marginBottom: 10, backgroundColor: '#fbfcfe' },
  gradeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: '#f0f2f6' },
  importRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f0f2f6' },
});
