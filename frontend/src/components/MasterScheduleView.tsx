import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ActivityIndicator, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../services/api';

// لوحة ألوان ثابتة عالية التمييز (بأسلوب aSc Timetables)
const PALETTE = [
  '#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00acc1',
  '#fdd835', '#d81b60', '#5e35b1', '#00897b', '#f4511e', '#3949ab',
  '#7cb342', '#ffb300', '#c0ca33', '#6d4c41', '#039be5', '#e91e63',
  '#4caf50', '#ff7043', '#9c27b0', '#26a69a', '#ec407a', '#66bb6a',
];

function courseColor(courseId: string): string {
  let h = 0;
  for (let i = 0; i < courseId.length; i++) h = (h * 31 + courseId.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function textColorFor(bg: string): string {
  const r = parseInt(bg.slice(1, 3), 16), g = parseInt(bg.slice(3, 5), 16), b = parseInt(bg.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#1a1a1a' : '#fff';
}

function shortName(full: string): string {
  if (!full) return '';
  const parts = full.trim().split(/\s+/);
  if (parts.length <= 2) return full;
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

interface Props {
  facultyId: string;
  departmentId?: string;
}

export const MasterScheduleView = ({ facultyId, departmentId }: Props) => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [selected, setSelected] = useState<any>(null); // الخلية المحددة (entry)
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [addModal, setAddModal] = useState<{ group: any; day: string; slotNumber: number } | null>(null);
  const [addCourseId, setAddCourseId] = useState('');
  const [addRoomId, setAddRoomId] = useState('');
  const [slotRooms, setSlotRooms] = useState<any[] | null>(null); // قاعات (يوم/فترة) مع حالة الانشغال
  const [validMap, setValidMap] = useState<Record<string, { valid: boolean; reasons: string[] }> | null>(null);
  const [placing, setPlacing] = useState<any>(null); // مقرر غير مدرج قيد الإدراج
  const [importModal, setImportModal] = useState(false);
  const [importDept, setImportDept] = useState('');
  const [importDepts, setImportDepts] = useState<any[]>([]);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importReport, setImportReport] = useState<any>(null);
  const [importing, setImporting] = useState(false);
  const [resolverModal, setResolverModal] = useState(false);
  const [resolverDept, setResolverDept] = useState('');
  const [resolverDepts, setResolverDepts] = useState<any[]>([]);
  const [resolverPlan, setResolverPlan] = useState<any>(null);
  const [resolving, setResolving] = useState(false);
  const [integrityModal, setIntegrityModal] = useState(false);
  const [integrityReport, setIntegrityReport] = useState<any>(null);
  const [integrityFixResult, setIntegrityFixResult] = useState<any>(null);
  const [checking, setChecking] = useState(false);

  const runIntegrityCheck = async () => {
    setChecking(true);
    setIntegrityFixResult(null);
    try {
      const params: any = { faculty_id: facultyId };
      if (departmentId) params.department_id = departmentId;
      const res = await api.get('/weekly-schedule/integrity-check', { params });
      setIntegrityReport(res.data);
    } catch (e: any) {
      window.alert(typeof e?.response?.data?.detail === 'string' ? e.response.data.detail : 'فشل فحص التكامل');
    } finally { setChecking(false); }
  };

  const openIntegrityModal = () => {
    setIntegrityReport(null); setIntegrityFixResult(null);
    setIntegrityModal(true);
    runIntegrityCheck();
  };

  const runIntegrityFix = async () => {
    setChecking(true);
    try {
      const params: any = { faculty_id: facultyId };
      if (departmentId) params.department_id = departmentId;
      const res = await api.post('/weekly-schedule/integrity-fix', null, { params });
      setIntegrityFixResult(res.data);
      const check = await api.get('/weekly-schedule/integrity-check', { params });
      setIntegrityReport(check.data);
      await load();
    } catch (e: any) {
      window.alert(typeof e?.response?.data?.detail === 'string' ? e.response.data.detail : 'فشل الإصلاح التلقائي');
    } finally { setChecking(false); }
  };

  const openResolverModal = async () => {
    setResolverPlan(null);
    setResolverModal(true);
    try {
      const res = await api.get('/departments');
      const list = (res.data || []).filter((d: any) => d.faculty_id === facultyId);
      setResolverDepts(list);
      setResolverDept(departmentId || (list.length === 1 ? list[0].id : ''));
    } catch { setResolverDepts([]); }
  };

  const runResolverPreview = async () => {
    if (!resolverDept) { window.alert('اختر القسم أولاً'); return; }
    setResolving(true);
    try {
      const res = await api.post('/weekly-schedule/resolve-unscheduled/preview', null, {
        params: { faculty_id: facultyId, department_id: resolverDept },
      });
      setResolverPlan(res.data);
    } catch (e: any) {
      window.alert(typeof e?.response?.data?.detail === 'string' ? e.response.data.detail : 'خطأ في بناء الخطة');
    } finally { setResolving(false); }
  };

  const commitResolverPlan = async () => {
    if (!resolverPlan) return;
    setResolving(true);
    try {
      const res = await api.post('/weekly-schedule/resolve-unscheduled/commit', {
        faculty_id: facultyId,
        department_id: resolverDept,
        moves: (resolverPlan.moves || []).map((m: any) => ({ slot_id: m.slot_id, to_day: m.to_day, to_slot: m.to_slot, room_id: m.room_id || '' })),
        placements: (resolverPlan.placements || []).map((p: any) => ({ course_id: p.course_id, level: p.level, section: p.section || '', day: p.day, slot_number: p.slot_number, room_id: p.room_id || '' })),
      });
      showMsg('success', res.data.message);
      setResolverModal(false);
      await load();
    } catch (e: any) {
      window.alert(typeof e?.response?.data?.detail === 'string' ? e.response.data.detail : 'فشل تنفيذ الخطة');
    } finally { setResolving(false); }
  };

  const openImportModal = async () => {
    setImportReport(null); setImportFile(null);
    setImportModal(true);
    try {
      const res = await api.get('/departments');
      const list = (res.data || []).filter((d: any) => d.faculty_id === facultyId);
      setImportDepts(list);
      setImportDept(departmentId || (list.length === 1 ? list[0].id : ''));
    } catch { setImportDepts([]); }
  };

  const downloadImportTemplate = async () => {
    if (!importDept) { window.alert('اختر القسم أولاً'); return; }
    setImporting(true);
    try {
      const res = await api.get('/weekly-schedule/import-template', {
        params: { faculty_id: facultyId, department_id: importDept }, responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = 'schedule_import_template.xlsx'; a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      let m = 'فشل تحميل القالب';
      try { const p = JSON.parse(await e?.response?.data?.text()); if (p?.detail) m = p.detail; } catch {}
      window.alert(m);
    } finally { setImporting(false); }
  };

  const runImport = async (dryRun: boolean) => {
    if (!importDept || !importFile) { window.alert('اختر القسم والملف أولاً'); return; }
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append('file', importFile);
      fd.append('faculty_id', facultyId);
      fd.append('department_id', importDept);
      fd.append('dry_run', dryRun ? '1' : '0');
      const res = await api.post('/weekly-schedule/import-master', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setImportReport(res.data);
      if (!dryRun && !(res.data.conflicts?.length)) {
        showMsg('success', res.data.message);
        setImportModal(false);
        await load();
      }
    } catch (e: any) {
      window.alert(typeof e?.response?.data?.detail === 'string' ? e.response.data.detail : 'خطأ في الاستيراد');
    } finally { setImporting(false); }
  };

  const load = useCallback(async () => {
    if (!facultyId) return;
    setLoading(true);
    try {
      const params: any = { faculty_id: facultyId };
      if (departmentId) params.department_id = departmentId;
      const res = await api.get('/weekly-schedule/master-view', { params });
      setData(res.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [facultyId, departmentId]);

  useEffect(() => { setSelected(null); setPlacing(null); setValidMap(null); load(); }, [load]);

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 6000);
  };

  const handleConflictError = (e: any) => {
    const d = e?.response?.data?.detail;
    if (d && typeof d === 'object' && d.conflicts) {
      showMsg('error', `❌ ${d.message}: ${d.conflicts.join(' • ')}`);
    } else {
      showMsg('error', typeof d === 'string' ? d : 'حدث خطأ');
    }
  };

  // جلب الخلايا الصالحة (بدون تعارضات) لإضاءتها بصرياً
  const fetchValidSlots = async (group: any, teacherId: string, roomId: string, excludeId: string) => {
    setValidMap(null);
    try {
      const res = await api.get('/weekly-schedule/valid-slots', {
        params: {
          faculty_id: facultyId, department_id: group.department_id,
          level: group.level, section: group.section,
          teacher_id: teacherId || '', room_id: roomId || '', exclude_slot_id: excludeId || '',
        },
      });
      const m: Record<string, { valid: boolean; reasons: string[] }> = {};
      for (const c of res.data.cells || []) m[`${c.day}|${c.slot_number}`] = { valid: c.valid, reasons: c.reasons };
      setValidMap(m);
    } catch { setValidMap(null); }
  };

  // نقرة على بلوك محاضرة
  const onEntryClick = async (entry: any) => {
    if (!editMode) return;
    if (placing) { setPlacing(null); setValidMap(null); }
    if (!selected) {
      setSelected(entry);
      fetchValidSlots(
        { department_id: entry.department_id, level: entry.level, section: entry.section },
        entry.teacher_id, entry.room_id || '', entry.id
      );
      return;
    }
    if (selected.id === entry.id) { setSelected(null); setValidMap(null); return; }
    // تبديل
    setBusy(true);
    try {
      const res = await api.post('/weekly-schedule/swap-slots', { slot_a_id: selected.id, slot_b_id: entry.id });
      showMsg('success', `✅ ${res.data.message}`);
      setSelected(null);
      setValidMap(null);
      await load();
    } catch (e: any) { handleConflictError(e); }
    finally { setBusy(false); }
  };

  // نقرة على خلية فارغة: نقل المحاضرة المحددة، أو إدراج المقرر قيد الإدراج، أو إضافة من القائمة
  const onEmptyCellClick = async (group: any, day: string, slotNumber: number) => {
    if (!editMode) return;
    const vstate = validMap?.[`${day}|${slotNumber}`];

    // وضع الإدراج: مقرر غير مدرج محدد من القائمة السفلية
    if (placing && !selected) {
      if (placing.department_id !== group.department_id || placing.level !== group.level || placing.section !== group.section) {
        showMsg('error', '⚠️ هذا المقرر يخص شعبة أخرى — اختر خلية في صف شعبته المُضاء');
        return;
      }
      if (vstate && !vstate.valid) {
        showMsg('error', `❌ لا يمكن الإدراج هنا: ${vstate.reasons.join(' • ')}`);
        return;
      }
      setAddCourseId(placing.course_id);
      setAddRoomId('');
      setSlotRooms(null);
      setAddModal({ group, day, slotNumber });
      api.get('/weekly-schedule/free-rooms', { params: { faculty_id: facultyId, day, slot_number: slotNumber } })
        .then(res => setSlotRooms(res.data || []))
        .catch(() => setSlotRooms([]));
      return;
    }

    if (!selected) {
      const candidates = (data?.unscheduled || []).filter((u: any) =>
        u.department_id === group.department_id && u.level === group.level && u.section === group.section);
      if (candidates.length === 0) {
        showMsg('error', '⚠️ لا توجد مقررات غير مدرجة لهذه الشعبة — كل مقرراتها مكتملة في الجدول');
        return;
      }
      setAddCourseId(candidates.length === 1 ? candidates[0].course_id : '');
      setAddRoomId('');
      setSlotRooms(null);
      setAddModal({ group, day, slotNumber });
      api.get('/weekly-schedule/free-rooms', { params: { faculty_id: facultyId, day, slot_number: slotNumber } })
        .then(res => setSlotRooms(res.data || []))
        .catch(() => setSlotRooms([]));
      return;
    }
    if (selected.department_id !== group.department_id || selected.level !== group.level || selected.section !== group.section) {
      showMsg('error', '⚠️ يمكن نقل المحاضرة فقط داخل صف نفس الشعبة (نفس القسم والمستوى والشعبة)');
      return;
    }
    if (vstate && !vstate.valid) {
      showMsg('error', `❌ لا يمكن النقل هنا: ${vstate.reasons.join(' • ')}`);
      return;
    }
    setBusy(true);
    try {
      const res = await api.post('/weekly-schedule/move-slot', { slot_id: selected.id, target_day: day, target_slot_number: slotNumber });
      showMsg('success', `✅ ${res.data.message}`);
      setSelected(null);
      setValidMap(null);
      await load();
    } catch (e: any) { handleConflictError(e); }
    finally { setBusy(false); }
  };

  // اختيار مقرر غير مدرج من القائمة السفلية لإدراجه (وضع الإدراج)
  const togglePlacing = (u: any) => {
    if (!editMode) return;
    if (placing?.course_id === u.course_id && placing?.section === u.section && placing?.level === u.level) {
      setPlacing(null); setValidMap(null); return;
    }
    setSelected(null);
    setPlacing(u);
    fetchValidSlots(
      { department_id: u.department_id, level: u.level, section: u.section },
      u.teacher_id, '', ''
    );
  };

  // تأكيد إضافة محاضرة غير مدرجة في الخلية الفارغة
  const confirmAdd = async () => {
    if (!addModal || !addCourseId) return;
    const course = (data?.unscheduled || []).find((u: any) => u.course_id === addCourseId);
    if (!course) return;
    setBusy(true);
    try {
      const res = await api.post('/weekly-schedule', {
        faculty_id: facultyId,
        department_id: addModal.group.department_id,
        level: addModal.group.level,
        section: addModal.group.section,
        day: addModal.day,
        slot_number: addModal.slotNumber,
        course_id: course.course_id,
        teacher_id: course.teacher_id,
        room_id: addRoomId,
      });
      showMsg('success', `✅ ${res.data.message}`);
      setAddModal(null);
      setPlacing(null);
      setValidMap(null);
      await load();
    } catch (e: any) { handleConflictError(e); }
    finally { setBusy(false); }
  };

  // حذف المحاضرة المحددة من الجدول (تُحرر الفترة والقاعة والمعلم ويعود المقرر لغير المدرجة)
  const deleteSelected = async () => {
    if (!selected) return;
    const ok = window.confirm(
      `هل أنت متأكد من حذف "${selected.course_name}" من الجدول؟\n(${selected.day} · الفترة ${selected.slot_number})\n\nستتحرر الفترة والقاعة والمعلم، وسيعود المقرر لقائمة غير المدرجة.`
    );
    if (!ok) return;
    setBusy(true);
    try {
      await api.delete(`/weekly-schedule/${selected.id}`);
      showMsg('success', `✅ تم حذف "${selected.course_name}" من الجدول — عاد المقرر لقائمة غير المدرجة`);
      setSelected(null);
      await load();
    } catch (e: any) { handleConflictError(e); }
    finally { setBusy(false); }
  };

  // إدراج تلقائي لكل المقررات غير المدرجة
  const autoPlaceAll = async () => {
    const count = data?.unscheduled?.length || 0;
    if (!count) return;
    const ok = window.confirm(
      `سيتم توزيع ${count} مقرر غير مدرج تلقائياً على أفضل الأماكن الصالحة\n(مراعاة: تعارضات الشعبة والمعلم والقاعات وتفضيلات المعلمين وتوزيع الأيام)\n\nهل تريد المتابعة؟`
    );
    if (!ok) return;
    setBusy(true);
    try {
      const params: any = { faculty_id: facultyId };
      if (departmentId) params.department_id = departmentId;
      const res = await api.post('/weekly-schedule/auto-place-unscheduled', null, { params });
      const { placed = [], failed = [] } = res.data;
      let text = `✅ ${res.data.message}`;
      if (placed.length) text += ` — ${placed.slice(0, 4).map((p: any) => `${p.course_name} (${p.day} ف${p.slot_number}${p.room_name ? ` ${p.room_name}` : ''})`).join('، ')}${placed.length > 4 ? '...' : ''}`;
      if (failed.length) text += ` | ⚠️ تعذر: ${failed.map((f: any) => `${f.course_name}: ${f.reason}`).join('، ')}`;
      showMsg(failed.length ? 'error' : 'success', text);
      setPlacing(null); setValidMap(null); setSelected(null);
      await load();
    } catch (e: any) { handleConflictError(e); }
    finally { setBusy(false); }
  };

  const downloadExport = async (fmt: 'pdf' | 'excel') => {
    setBusy(true);
    try {
      const params: any = { faculty_id: facultyId };
      if (departmentId) params.department_id = departmentId;
      const res = await api.get(`/weekly-schedule/master-view/export/${fmt}`, { params, responseType: 'blob' });
      const objUrl = URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = objUrl;
      link.download = `master_schedule.${fmt === 'pdf' ? 'pdf' : 'xlsx'}`;
      link.click();
      URL.revokeObjectURL(objUrl);
      showMsg('success', `✅ تم تصدير ${fmt === 'pdf' ? 'PDF' : 'Excel'} بنجاح`);
    } catch (e: any) {
      let m = 'فشل التصدير';
      try {
        const blob = e?.response?.data;
        if (blob && typeof blob.text === 'function') {
          const parsed = JSON.parse(await blob.text());
          if (parsed?.detail) m = typeof parsed.detail === 'string' ? parsed.detail : m;
        }
      } catch {}
      showMsg('error', `❌ ${m}`);
    } finally { setBusy(false); }
  };

  if (Platform.OS !== 'web') {
    return <View style={{ padding: 20 }}><Text style={{ textAlign: 'center', color: '#888' }}>العرض الشامل متاح على الويب فقط</Text></View>;
  }

  if (loading && !data) {
    return <View style={{ padding: 40, alignItems: 'center' }}><ActivityIndicator size="large" color="#1565c0" /></View>;
  }
  if (!data) return null;

  const { working_days = [], time_slots = [], groups = [], entries = [], unscheduled = [], can_manage } = data;

  // فهرسة: (dept|level|section|day|slot) -> entries[]
  const cellMap: Record<string, any[]> = {};
  for (const e of entries) {
    const k = `${e.department_id}|${e.level}|${e.section}|${e.day}|${e.slot_number}`;
    (cellMap[k] = cellMap[k] || []).push(e);
  }

  const groupLabel = (g: any) => `${g.department_name} · م${g.level}${g.section ? ` · ${g.section}` : ''}`;

  return (
    <View testID="master-schedule-view">
      {/* شريط الأدوات */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        {can_manage && (
          <TouchableOpacity
            onPress={() => { setEditMode(!editMode); setSelected(null); }}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8,
              borderRadius: 8, backgroundColor: editMode ? '#e65100' : '#1565c0',
            }}
            testID="master-edit-mode-btn"
          >
            <Ionicons name={editMode ? 'close-circle' : 'move'} size={15} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>{editMode ? 'إنهاء وضع التحرير' : 'وضع التحرير (نقل/تبديل)'}</Text>
          </TouchableOpacity>
        )}
        {editMode && selected && (
          <TouchableOpacity
            onPress={deleteSelected}
            disabled={busy}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#b71c1c' }}
            testID="master-delete-selected-btn"
          >
            <Ionicons name="trash" size={14} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>حذف المحددة</Text>
          </TouchableOpacity>
        )}
        {editMode && (
          <View style={{ backgroundColor: '#fff8e1', borderWidth: 1, borderColor: '#ffe082', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}>
            <Text style={{ fontSize: 11, color: '#e65100', fontWeight: '600' }}>
              {selected
                ? `♟️ محدد: ${selected.course_name} — انقر خلية فارغة للنقل أو محاضرة أخرى للتبديل أو زر الحذف`
                : '♟️ انقر محاضرة لتحديدها (نقل/تبديل/حذف) • أو انقر خلية فارغة لإضافة مقرر غير مدرج'}
            </Text>
          </View>
        )}
        {busy && <ActivityIndicator size="small" color="#1565c0" />}
        <TouchableOpacity
          onPress={() => downloadExport('pdf')}
          disabled={busy}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#c62828' }}
          testID="master-export-pdf-btn"
        >
          <Ionicons name="document-text" size={14} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>PDF ملوّن</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => downloadExport('excel')}
          disabled={busy}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#2e7d32' }}
          testID="master-export-excel-btn"
        >
          <Ionicons name="grid" size={14} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>Excel ملوّن</Text>
        </TouchableOpacity>
        {can_manage && (
          <TouchableOpacity
            onPress={openImportModal}
            disabled={busy}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#6a1b9a' }}
            testID="master-import-excel-btn"
          >
            <Ionicons name="cloud-upload" size={14} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>استيراد Excel</Text>
          </TouchableOpacity>
        )}
        {can_manage && (
          <TouchableOpacity
            onPress={openIntegrityModal}
            disabled={busy}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#00796b' }}
            testID="master-integrity-check-btn"
          >
            <Ionicons name="shield-checkmark" size={14} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>فحص التكامل</Text>
          </TouchableOpacity>
        )}
        <View style={{ marginLeft: 'auto', backgroundColor: '#e3f2fd', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 }}>
          <Text style={{ fontSize: 12, color: '#1565c0', fontWeight: '600' }}>{groups.length} شعبة • {entries.length} محاضرة</Text>
        </View>
      </View>

      {/* رسالة نجاح/خطأ */}
      {msg && (
        <TouchableOpacity onPress={() => setMsg(null)} style={{
          backgroundColor: msg.type === 'success' ? '#e8f5e9' : '#ffebee',
          borderWidth: 1, borderColor: msg.type === 'success' ? '#a5d6a7' : '#ef9a9a',
          borderRadius: 8, padding: 10, marginBottom: 8,
        }} testID="master-msg-banner">
          <Text style={{ fontSize: 12, color: msg.type === 'success' ? '#2e7d32' : '#c62828', textAlign: 'right', fontWeight: '600' }}>{msg.text}</Text>
        </TouchableOpacity>
      )}

      {/* الجدول الشامل */}
      <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '72vh', direction: 'rtl', border: '1px solid #dde3ec', borderRadius: 10, backgroundColor: '#fff' }}>
        <table style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
          <thead>
            <tr>
              <th style={{
                position: 'sticky', right: 0, top: 0, zIndex: 5, backgroundColor: '#0d2a52', color: '#fff',
                padding: '8px 10px', fontSize: 12, minWidth: 150, borderLeft: '2px solid #fff',
              }}>المستوى / الشعبة</th>
              {working_days.map((day: string) => (
                <th key={day} colSpan={time_slots.length} style={{
                  position: 'sticky', top: 0, zIndex: 3, backgroundColor: '#1565c0', color: '#fff',
                  padding: '6px 4px', fontSize: 13, fontWeight: 700, borderLeft: '2px solid #fff', textAlign: 'center',
                }}>{day}</th>
              ))}
            </tr>
            <tr>
              <th style={{
                position: 'sticky', right: 0, top: 33, zIndex: 5, backgroundColor: '#0d2a52',
                borderLeft: '2px solid #fff', padding: 2,
              }}></th>
              {working_days.map((day: string) =>
                time_slots.map((ts: any, ti: number) => (
                  <th key={`${day}-${ts.slot_number}`} style={{
                    position: 'sticky', top: 33, zIndex: 3, backgroundColor: '#3d7ede', color: '#fff',
                    padding: '3px 4px', fontSize: 10, fontWeight: 600, minWidth: 92, textAlign: 'center',
                    borderLeft: ti === time_slots.length - 1 ? '2px solid #fff' : '1px solid rgba(255,255,255,0.3)',
                  }}>
                    {ts.slot_number}<br /><span style={{ fontSize: 9, opacity: 0.85 }}>{ts.start_time}</span>
                  </th>
                ))
              )}
            </tr>
          </thead>
          <tbody>
            {groups.map((g: any, gi: number) => (
              <tr key={`${g.department_id}-${g.level}-${g.section}`} style={{ backgroundColor: gi % 2 === 0 ? '#fafbfd' : '#fff' }}>
                <td style={{
                  position: 'sticky', right: 0, zIndex: 2, backgroundColor: gi % 2 === 0 ? '#eef3fa' : '#f5f8fc',
                  padding: '6px 8px', fontSize: 11, fontWeight: 700, color: '#1a2540',
                  borderBottom: '1px solid #e3e9f2', borderLeft: '2px solid #c9d4e5', whiteSpace: 'nowrap',
                }}>{groupLabel(g)}</td>
                {working_days.map((day: string) =>
                  time_slots.map((ts: any, ti: number) => {
                    const k = `${g.department_id}|${g.level}|${g.section}|${day}|${ts.slot_number}`;
                    const items = cellMap[k] || [];
                    const isEmpty = items.length === 0;
                    const target = selected || placing; // المحاضرة المحددة أو المقرر قيد الإدراج
                    const inTargetRow = editMode && target && isEmpty
                      && target.department_id === g.department_id && target.level === g.level && target.section === g.section;
                    const vstate = inTargetRow ? validMap?.[`${day}|${ts.slot_number}`] : undefined;
                    const canDrop = inTargetRow && (!vstate || vstate.valid);
                    const isBlocked = inTargetRow && vstate && !vstate.valid;
                    const canAdd = editMode && !selected && !placing && isEmpty;
                    return (
                      <td
                        key={`${day}-${ts.slot_number}`}
                        onClick={isEmpty ? () => onEmptyCellClick(g, day, ts.slot_number) : undefined}
                        data-testid={`master-cell-${gi}-${day}-${ts.slot_number}`}
                        title={isBlocked ? `❌ ${vstate!.reasons.join(' • ')}` : canDrop ? '✓ مكان صالح بدون تعارضات' : undefined}
                        style={{
                          padding: 2, verticalAlign: 'top', minWidth: 92, height: 34,
                          borderBottom: '1px solid #e3e9f2',
                          borderLeft: ti === time_slots.length - 1 ? '2px solid #c9d4e5' : '1px solid #eef1f6',
                          backgroundColor: canDrop ? '#e8f5e9' : isBlocked ? '#fdecea' : undefined,
                          cursor: canDrop ? 'pointer' : isBlocked ? 'not-allowed' : canAdd ? 'pointer' : undefined,
                          outline: canDrop ? '2px dashed #43a047' : isBlocked ? '1px dashed #ef9a9a' : undefined,
                          outlineOffset: -2,
                        }}
                      >
                        {items.map((item: any) => {
                          const bg = courseColor(item.course_id);
                          const fg = textColorFor(bg);
                          const isSel = selected?.id === item.id;
                          return (
                            <div
                              key={item.id}
                              onClick={(ev: any) => { ev.stopPropagation(); onEntryClick(item); }}
                              title={`${item.course_name}\n${item.teacher_name}\n${item.room_name}`}
                              data-testid={`master-entry-${item.id}`}
                              style={{
                                backgroundColor: bg, color: fg, borderRadius: 4, padding: '2px 4px', marginBottom: 1,
                                fontSize: 10, lineHeight: 1.25, textAlign: 'center',
                                cursor: editMode ? 'pointer' : 'default',
                                outline: isSel ? '3px solid #1a1a1a' : undefined,
                                boxShadow: isSel ? '0 0 8px rgba(0,0,0,0.5)' : undefined,
                                opacity: editMode && selected && !isSel ? 0.85 : 1,
                              }}
                            >
                              <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 110 }}>{item.course_name}</div>
                              <div style={{ fontSize: 8.5, opacity: 0.9, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 110 }}>
                                {shortName(item.teacher_name)}{item.room_name ? ` · ${item.room_name}` : ''}
                              </div>
                            </div>
                          );
                        })}
                      </td>
                    );
                  })
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* نافذة إضافة مقرر غير مدرج في خلية فارغة */}
      {addModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100,
          backgroundColor: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', direction: 'rtl',
        }} onClick={() => setAddModal(null)}>
          <div onClick={(ev: any) => ev.stopPropagation()} style={{
            backgroundColor: '#fff', borderRadius: 12, padding: 20, width: 440, maxWidth: '92%', maxHeight: '80vh', overflowY: 'auto',
            boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
          }} data-testid="master-add-modal">
            <div style={{ fontSize: 15, fontWeight: 800, color: '#1a2540', marginBottom: 4, textAlign: 'right' }}>➕ إضافة محاضرة غير مدرجة</div>
            <div style={{ fontSize: 12, color: '#5b6678', marginBottom: 12, textAlign: 'right' }}>
              {addModal.group.department_name} · م{addModal.group.level}{addModal.group.section ? ` · ${addModal.group.section}` : ''} — {addModal.day} · الفترة {addModal.slotNumber}
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#333', marginBottom: 6, textAlign: 'right' }}>اختر المقرر (من غير المدرجة فقط):</div>
            {(data?.unscheduled || [])
              .filter((u: any) => u.department_id === addModal.group.department_id && u.level === addModal.group.level && u.section === addModal.group.section)
              .map((u: any) => (
                <div key={u.course_id} onClick={() => setAddCourseId(u.course_id)} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, marginBottom: 5, cursor: 'pointer',
                  border: addCourseId === u.course_id ? '2px solid #1565c0' : '1px solid #e3e9f2',
                  backgroundColor: addCourseId === u.course_id ? '#e3f2fd' : '#fafbfd',
                }} data-testid={`add-course-option-${u.course_id}`}>
                  <div style={{
                    width: 12, height: 12, borderRadius: 3, backgroundColor: courseColor(u.course_id), flexShrink: 0,
                  }} />
                  <div style={{ flex: 1, textAlign: 'right' }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: '#333' }}>{u.course_name}</div>
                    <div style={{ fontSize: 10.5, color: '#777' }}>{u.teacher_name} • ناقص {u.missing} من {u.needed} أسبوعياً</div>
                  </div>
                  {addCourseId === u.course_id && <Ionicons name="checkmark-circle" size={18} color="#1565c0" />}
                </div>
              ))}
            <div style={{ fontSize: 12, fontWeight: 700, color: '#333', margin: '10px 0 6px', textAlign: 'right' }}>
              القاعة (الفارغة في هذا الوقت فقط):
            </div>
            {slotRooms === null ? (
              <div style={{ fontSize: 11.5, color: '#888', textAlign: 'right', padding: '6px 0' }}>جاري فحص توفر القاعات...</div>
            ) : (
              <>
                <select value={addRoomId} onChange={(ev: any) => setAddRoomId(ev.target.value)} style={{
                  width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, direction: 'rtl', backgroundColor: '#f7f9fc',
                }} data-testid="add-room-select">
                  <option value="">-- بدون قاعة --</option>
                  {slotRooms.filter((r: any) => !r.busy).map((r: any) => (
                    <option key={r.id} value={r.id}>{r.name}{r.building ? ` (${r.building})` : ''}{r.capacity ? ` — سعة ${r.capacity}` : ''}</option>
                  ))}
                </select>
                {slotRooms.filter((r: any) => r.busy).length > 0 && (
                  <div style={{ fontSize: 10.5, color: '#e65100', textAlign: 'right', marginTop: 5 }} data-testid="busy-rooms-note">
                    🔒 استُثنيت {slotRooms.filter((r: any) => r.busy).length} قاعة مشغولة في هذا الوقت: {slotRooms.filter((r: any) => r.busy).map((r: any) => r.name).join('، ')}
                  </div>
                )}
                {slotRooms.filter((r: any) => !r.busy).length === 0 && (
                  <div style={{ fontSize: 11, color: '#c62828', textAlign: 'right', marginTop: 5, fontWeight: 700 }}>
                    ⚠️ جميع القاعات مشغولة في هذا الوقت — يمكن الإضافة بدون قاعة
                  </div>
                )}
              </>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button onClick={confirmAdd} disabled={!addCourseId || busy} style={{
                flex: 1, padding: '10px 0', borderRadius: 8, border: 'none', cursor: addCourseId ? 'pointer' : 'not-allowed',
                backgroundColor: addCourseId ? '#2e7d32' : '#c8d2c9', color: '#fff', fontSize: 13.5, fontWeight: 700,
              }} data-testid="confirm-add-slot-btn">{busy ? 'جاري الإضافة...' : 'إضافة المحاضرة'}</button>
              <button onClick={() => setAddModal(null)} style={{
                flex: 0.5, padding: '10px 0', borderRadius: 8, border: '1px solid #ddd', cursor: 'pointer',
                backgroundColor: '#fff', color: '#555', fontSize: 13, fontWeight: 600,
              }}>إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* نافذة فحص التكامل */}
      {integrityModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100,
          backgroundColor: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', direction: 'rtl',
        }} onClick={() => !checking && setIntegrityModal(false)}>
          <div onClick={(ev: any) => ev.stopPropagation()} style={{
            backgroundColor: '#fff', borderRadius: 12, padding: 20, width: 620, maxWidth: '94%', maxHeight: '85vh', overflowY: 'auto',
            boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
          }} data-testid="master-integrity-modal">
            <div style={{ fontSize: 15, fontWeight: 800, color: '#1a2540', marginBottom: 4, textAlign: 'right' }}>🛡️ فحص تكامل الجدول الأسبوعي</div>
            <div style={{ fontSize: 11.5, color: '#5b6678', marginBottom: 12, textAlign: 'right', lineHeight: 1.7 }}>
              يقارن خلايا الجدول مع بيانات النظام الحية (المقررات، الإسنادات، القاعات) ويكشف أي انحراف: مقررات محذوفة، أساتذة مختلفون عن الإسناد، قاعات محذوفة/معطّلة، أو مستويات غير مطابقة — مع إصلاح تلقائي بضغطة واحدة.
            </div>

            {checking && <div style={{ fontSize: 12.5, color: '#00796b', fontWeight: 700, textAlign: 'center', padding: 12 }}>⏳ جاري الفحص...</div>}

            {integrityFixResult && (
              <div style={{ backgroundColor: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: 8, padding: 10, marginBottom: 10 }} data-testid="integrity-fix-result">
                <div style={{ fontSize: 12.5, fontWeight: 800, color: '#2e7d32', textAlign: 'right' }}>{integrityFixResult.message}</div>
                {(integrityFixResult.failed || []).map((f: string, i: number) => (
                  <div key={i} style={{ fontSize: 11, color: '#c62828', textAlign: 'right', marginTop: 4 }}>{f}</div>
                ))}
              </div>
            )}

            {integrityReport && !checking && (
              <>
                {integrityReport.issues.length === 0 ? (
                  <div style={{ backgroundColor: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: 8, padding: 14, textAlign: 'center' }} data-testid="integrity-clean">
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#2e7d32' }}>✅ الجدول متكامل تماماً</div>
                    <div style={{ fontSize: 11.5, color: '#557a5a', marginTop: 4 }}>تم فحص {integrityReport.total_slots} محاضرة — لا يوجد أي انحراف عن بيانات النظام</div>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, backgroundColor: '#e3f2fd', color: '#1565c0', borderRadius: 6, padding: '4px 8px' }}>
                        فُحصت {integrityReport.total_slots} محاضرة
                      </span>
                      {integrityReport.summary.map((s: any) => (
                        <span key={s.type} style={{ fontSize: 11, fontWeight: 700, backgroundColor: '#fff3e0', color: '#e65100', borderRadius: 6, padding: '4px 8px' }}>
                          {s.label}: {s.count}
                        </span>
                      ))}
                    </div>
                    <div style={{ maxHeight: '38vh', overflowY: 'auto', border: '1px solid #eef1f6', borderRadius: 8, padding: 8, marginBottom: 10 }}>
                      {integrityReport.issues.map((it: any, i: number) => (
                        <div key={i} style={{
                          fontSize: 11.5, textAlign: 'right', padding: '6px 8px', borderRadius: 6, marginBottom: 4, lineHeight: 1.6,
                          backgroundColor: it.fixable ? '#fffde7' : '#fdecea',
                          color: it.fixable ? '#7a6400' : '#c62828',
                        }}>
                          {it.fixable ? '🔧' : '✋'} {it.desc}
                        </div>
                      ))}
                    </div>
                    {integrityReport.manual_count > 0 && (
                      <div style={{ fontSize: 11, color: '#c62828', textAlign: 'right', marginBottom: 8, fontWeight: 700 }}>
                        ✋ {integrityReport.manual_count} حالة تحتاج تدخلاً يدوياً (لن يشملها الإصلاح التلقائي)
                      </div>
                    )}
                  </>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  {integrityReport.fixable_count > 0 && (
                    <button onClick={runIntegrityFix} disabled={checking} style={{
                      flex: 1, padding: '10px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
                      backgroundColor: '#00796b', color: '#fff', fontSize: 13.5, fontWeight: 700,
                    }} data-testid="integrity-fix-btn">🔧 إصلاح تلقائي ({integrityReport.fixable_count})</button>
                  )}
                  <button onClick={runIntegrityCheck} disabled={checking} style={{
                    flex: 0.7, padding: '10px 0', borderRadius: 8, border: '1px solid #00796b', cursor: 'pointer',
                    backgroundColor: '#fff', color: '#00796b', fontSize: 13, fontWeight: 700,
                  }} data-testid="integrity-recheck-btn">🔄 إعادة الفحص</button>
                  <button onClick={() => setIntegrityModal(false)} style={{
                    flex: 0.5, padding: '10px 0', borderRadius: 8, border: '1px solid #ddd', cursor: 'pointer',
                    backgroundColor: '#fff', color: '#555', fontSize: 13, fontWeight: 600,
                  }}>إغلاق</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* نافذة استيراد الجدول من Excel */}
      {importModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100,
          backgroundColor: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', direction: 'rtl',
        }} onClick={() => !importing && setImportModal(false)}>
          <div onClick={(ev: any) => ev.stopPropagation()} style={{
            backgroundColor: '#fff', borderRadius: 12, padding: 20, width: 560, maxWidth: '94%', maxHeight: '85vh', overflowY: 'auto',
            boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
          }} data-testid="master-import-modal">
            <div style={{ fontSize: 15, fontWeight: 800, color: '#1a2540', marginBottom: 4, textAlign: 'right' }}>📥 استيراد الجدول الأسبوعي من Excel</div>
            <div style={{ fontSize: 11.5, color: '#5b6678', marginBottom: 12, textAlign: 'right', lineHeight: 1.7 }}>
              السياسة: <b style={{ color: '#6a1b9a' }}>الإكسل هو الأساس</b> — الخلايا المعبأة في الملف <b>تستبدل</b> ما يقابلها في النظام، و<b>الإسناد يتبع اسم الأستاذ في الملف</b> (مقرر بلا إسناد يُسند، وإسناد مختلف يُستبدل) • الخلايا الفارغة لا تمس الموجود • أخطاء الأسماء تُتخطى مع تقرير • <b style={{ color: '#c62828' }}>أي تعارض جدولة يوقف الاستيراد كاملاً</b>
            </div>

            <div style={{ fontSize: 12, fontWeight: 700, color: '#333', marginBottom: 6, textAlign: 'right' }}>1) اختر القسم:</div>
            <select value={importDept} onChange={(ev: any) => { setImportDept(ev.target.value); setImportReport(null); }} style={{
              width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, direction: 'rtl', backgroundColor: '#f7f9fc', marginBottom: 12,
            }} data-testid="import-dept-select">
              <option value="">-- اختر القسم --</option>
              {importDepts.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>

            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' as any }}>
              <button onClick={downloadImportTemplate} disabled={importing || !importDept} style={{
                padding: '8px 14px', borderRadius: 8, border: 'none', cursor: importDept ? 'pointer' : 'not-allowed',
                backgroundColor: importDept ? '#1565c0' : '#b0bec5', color: '#fff', fontSize: 12.5, fontWeight: 700,
              }} data-testid="download-import-template-btn">⬇️ تحميل قالب القسم (بالأسماء الدقيقة)</button>
              <button onClick={() => {
                const input = document.createElement('input');
                input.type = 'file'; input.accept = '.xlsx';
                input.onchange = (ev: any) => {
                  const f = ev.target.files?.[0];
                  if (f) { setImportFile(f); setImportReport(null); }
                };
                input.click();
              }} disabled={importing} style={{
                padding: '8px 14px', borderRadius: 8, border: '1px dashed #6a1b9a', cursor: 'pointer',
                backgroundColor: '#f3e5f5', color: '#6a1b9a', fontSize: 12.5, fontWeight: 700,
              }} data-testid="pick-import-file-btn">📎 {importFile ? importFile.name : 'اختر ملف Excel'}</button>
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button onClick={() => runImport(true)} disabled={importing || !importFile || !importDept} style={{
                flex: 1, padding: '10px 0', borderRadius: 8, border: 'none',
                cursor: importFile && importDept ? 'pointer' : 'not-allowed',
                backgroundColor: importFile && importDept ? '#e65100' : '#cfd8dc', color: '#fff', fontSize: 13, fontWeight: 700,
              }} data-testid="import-dry-run-btn">{importing ? 'جاري الفحص...' : '🔍 معاينة (فحص بدون حفظ)'}</button>
              {importReport?.can_commit && importReport?.dry_run && (
                <button onClick={() => runImport(false)} disabled={importing} style={{
                  flex: 1, padding: '10px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
                  backgroundColor: '#2e7d32', color: '#fff', fontSize: 13, fontWeight: 700,
                }} data-testid="import-confirm-btn">{importing ? 'جاري الاستيراد...' : `✅ تأكيد (${importReport.to_create} إدراج${importReport.to_replace ? ` + ${importReport.to_replace} استبدال` : ''})`}</button>
              )}
            </div>

            {importReport && (
              <div data-testid="import-report">
                <div style={{
                  padding: '10px 12px', borderRadius: 8, marginBottom: 8, fontSize: 12.5, fontWeight: 700, textAlign: 'right',
                  backgroundColor: importReport.conflicts?.length ? '#ffebee' : '#e8f5e9',
                  color: importReport.conflicts?.length ? '#c62828' : '#2e7d32',
                }}>{importReport.message}</div>
                {importReport.conflicts?.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: '#c62828', textAlign: 'right', marginBottom: 4 }}>🛑 تعارضات توقف الاستيراد ({importReport.conflicts.length}):</div>
                    <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid #ef9a9a', borderRadius: 8, padding: 8, backgroundColor: '#fff8f8' }}>
                      {importReport.conflicts.map((c: string, i: number) => (
                        <div key={i} style={{ fontSize: 11, color: '#b71c1c', textAlign: 'right', padding: '3px 0', borderBottom: '1px dashed #ffcdd2' }}>{c}</div>
                      ))}
                    </div>
                  </div>
                )}
                {importReport.reassigned?.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: '#1565c0', textAlign: 'right', marginBottom: 4 }}>🧑‍🏫 إسنادات ستتغير ({importReport.reassigned.length}):</div>
                    <div style={{ maxHeight: 130, overflowY: 'auto', border: '1px solid #90caf9', borderRadius: 8, padding: 8, backgroundColor: '#f4f9ff' }}>
                      {importReport.reassigned.map((c: string, i: number) => (
                        <div key={i} style={{ fontSize: 11, color: '#0d47a1', textAlign: 'right', padding: '3px 0', borderBottom: '1px dashed #bbdefb' }}>{c}</div>
                      ))}
                    </div>
                  </div>
                )}
                {importReport.replaced?.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: '#6a1b9a', textAlign: 'right', marginBottom: 4 }}>🔁 خلايا ستُستبدل بمحتوى الملف ({importReport.replaced.length}):</div>
                    <div style={{ maxHeight: 150, overflowY: 'auto', border: '1px solid #ce93d8', borderRadius: 8, padding: 8, backgroundColor: '#faf5fc' }}>
                      {importReport.replaced.map((c: string, i: number) => (
                        <div key={i} style={{ fontSize: 11, color: '#4a148c', textAlign: 'right', padding: '3px 0', borderBottom: '1px dashed #e1bee7' }}>{c}</div>
                      ))}
                    </div>
                  </div>
                )}
                {importReport.errors?.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: '#e65100', textAlign: 'right', marginBottom: 4 }}>⚠️ خلايا مُتخطاة لأخطاء أسماء ({importReport.errors.length}):</div>
                    <div style={{ maxHeight: 140, overflowY: 'auto', border: '1px solid #ffcc80', borderRadius: 8, padding: 8, backgroundColor: '#fffdf7' }}>
                      {importReport.errors.map((c: string, i: number) => (
                        <div key={i} style={{ fontSize: 11, color: '#bf5f00', textAlign: 'right', padding: '3px 0', borderBottom: '1px dashed #ffe0b2' }}>{c}</div>
                      ))}
                    </div>
                  </div>
                )}
                {importReport.skipped_existing?.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: '#5b6678', textAlign: 'right', marginBottom: 4 }}>✓ خلايا مطابقة تماماً للموجود — بلا تغيير ({importReport.skipped_existing.length}):</div>
                    <div style={{ maxHeight: 120, overflowY: 'auto', border: '1px solid #dde3ec', borderRadius: 8, padding: 8, backgroundColor: '#fafbfd' }}>
                      {importReport.skipped_existing.map((c: string, i: number) => (
                        <div key={i} style={{ fontSize: 11, color: '#5b6678', textAlign: 'right', padding: '3px 0', borderBottom: '1px dashed #e8edf4' }}>{c}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <button onClick={() => setImportModal(false)} disabled={importing} style={{
              width: '100%', padding: '9px 0', borderRadius: 8, border: '1px solid #ddd', cursor: 'pointer',
              backgroundColor: '#fff', color: '#555', fontSize: 13, fontWeight: 600, marginTop: 4,
            }} data-testid="close-import-modal-btn">إغلاق</button>
          </div>
        </div>
      )}

      {/* نافذة الحلحلة الذكية */}
      {resolverModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100,
          backgroundColor: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', direction: 'rtl',
        }} onClick={() => !resolving && setResolverModal(false)}>
          <div onClick={(ev: any) => ev.stopPropagation()} style={{
            backgroundColor: '#fff', borderRadius: 12, padding: 20, width: 620, maxWidth: '94%', maxHeight: '85vh', overflowY: 'auto',
            boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
          }} data-testid="resolver-modal">
            <div style={{ fontSize: 15, fontWeight: 800, color: '#1a2540', marginBottom: 4, textAlign: 'right' }}>🧩 الحلحلة الذكية للمقررات غير المدرجة</div>
            <div style={{ fontSize: 11.5, color: '#5b6678', marginBottom: 12, textAlign: 'right', lineHeight: 1.7 }}>
              يبحث النظام عن حلول بنقل محاضرات قائمة (<b>من نفس القسم فقط</b>، حتى نقلتين لكل إدراج) دون انتهاك أي تعارض أو تفضيلات معلم. <b>لا يُنفذ شيء قبل موافقتك على الخطة.</b>
            </div>

            <div style={{ fontSize: 12, fontWeight: 700, color: '#333', marginBottom: 6, textAlign: 'right' }}>القسم:</div>
            <select value={resolverDept} onChange={(ev: any) => { setResolverDept(ev.target.value); setResolverPlan(null); }} style={{
              width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, direction: 'rtl', backgroundColor: '#f7f9fc', marginBottom: 12,
            }} data-testid="resolver-dept-select">
              <option value="">-- اختر القسم --</option>
              {resolverDepts.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>

            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button onClick={runResolverPreview} disabled={resolving || !resolverDept} style={{
                flex: 1, padding: '10px 0', borderRadius: 8, border: 'none',
                cursor: resolverDept ? 'pointer' : 'not-allowed',
                backgroundColor: resolverDept ? '#00695c' : '#cfd8dc', color: '#fff', fontSize: 13, fontWeight: 700,
              }} data-testid="resolver-preview-btn">{resolving ? 'جاري بناء الخطة...' : '🔍 ابنِ خطة الحلحلة (معاينة)'}</button>
              {resolverPlan && (resolverPlan.placements?.length > 0) && (
                <button onClick={commitResolverPlan} disabled={resolving} style={{
                  flex: 1, padding: '10px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
                  backgroundColor: '#2e7d32', color: '#fff', fontSize: 13, fontWeight: 700,
                }} data-testid="resolver-commit-btn">{resolving ? 'جاري التنفيذ...' : `✅ نفّذ الخطة (${resolverPlan.placements.length} إدراج${resolverPlan.moves?.length ? ` + ${resolverPlan.moves.length} نقلة` : ''})`}</button>
              )}
            </div>

            {resolverPlan && (
              <div data-testid="resolver-plan">
                <div style={{
                  padding: '10px 12px', borderRadius: 8, marginBottom: 8, fontSize: 12.5, fontWeight: 700, textAlign: 'right',
                  backgroundColor: resolverPlan.placements?.length ? '#e8f5e9' : '#fff8e1',
                  color: resolverPlan.placements?.length ? '#2e7d32' : '#e65100',
                }}>{resolverPlan.message}</div>

                {resolverPlan.moves?.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: '#e65100', textAlign: 'right', marginBottom: 4 }}>🔀 النقلات المقترحة ({resolverPlan.moves.length}):</div>
                    <div style={{ maxHeight: 170, overflowY: 'auto', border: '1px solid #ffcc80', borderRadius: 8, padding: 8, backgroundColor: '#fffdf7' }}>
                      {resolverPlan.moves.map((m: any, i: number) => (
                        <div key={i} style={{ fontSize: 11.5, color: '#6d4c00', textAlign: 'right', padding: '4px 0', borderBottom: '1px dashed #ffe0b2', lineHeight: 1.6 }}>
                          <b>{m.course_name}</b> ({m.teacher_name} · {m.group}): {m.from_day} ف{m.from_slot} ← <b>{m.to_day} ف{m.to_slot}</b>
                          {m.room_changed ? ` · قاعة جديدة: ${m.room_name}` : m.room_name ? ` · ${m.room_name}` : ''}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {resolverPlan.placements?.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: '#2e7d32', textAlign: 'right', marginBottom: 4 }}>➕ الإدراجات ({resolverPlan.placements.length}):</div>
                    <div style={{ maxHeight: 170, overflowY: 'auto', border: '1px solid #a5d6a7', borderRadius: 8, padding: 8, backgroundColor: '#f7fdf8' }}>
                      {resolverPlan.placements.map((p: any, i: number) => (
                        <div key={i} style={{ fontSize: 11.5, color: '#1b5e20', textAlign: 'right', padding: '4px 0', borderBottom: '1px dashed #c8e6c9', lineHeight: 1.6 }}>
                          <b>{p.course_name}</b> ({p.teacher_name} · {p.group}) → <b>{p.day} ف{p.slot_number}</b>{p.room_name ? ` · ${p.room_name}` : ' · بدون قاعة'}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {resolverPlan.failed?.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: '#c62828', textAlign: 'right', marginBottom: 4 }}>❌ تعذر حلها ({resolverPlan.failed.length}):</div>
                    <div style={{ maxHeight: 130, overflowY: 'auto', border: '1px solid #ef9a9a', borderRadius: 8, padding: 8, backgroundColor: '#fff8f8' }}>
                      {resolverPlan.failed.map((f: any, i: number) => (
                        <div key={i} style={{ fontSize: 11.5, color: '#b71c1c', textAlign: 'right', padding: '4px 0', borderBottom: '1px dashed #ffcdd2', lineHeight: 1.6 }}>
                          <b>{f.course_name}</b> (م{f.level}{f.section ? `/${f.section}` : ''}) — {f.reason}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <button onClick={() => setResolverModal(false)} disabled={resolving} style={{
              width: '100%', padding: '9px 0', borderRadius: 8, border: '1px solid #ddd', cursor: 'pointer',
              backgroundColor: '#fff', color: '#555', fontSize: 13, fontWeight: 600, marginTop: 4,
            }} data-testid="close-resolver-modal-btn">إغلاق</button>
          </div>
        </div>
      )}

      {/* المقررات غير المدرجة */}
      {unscheduled.length > 0 && (
        <View style={{ marginTop: 12, backgroundColor: '#fff8e1', borderWidth: 1, borderColor: '#ffe082', borderRadius: 10, padding: 12 }} testID="unscheduled-courses-section">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            <Ionicons name="warning" size={16} color="#e65100" />
            <Text style={{ fontSize: 13, fontWeight: '800', color: '#e65100' }}>مقررات لم تُدرج في الجدول أو مدرجة جزئياً ({unscheduled.length})</Text>
            {can_manage && (
              <>
              <TouchableOpacity
                onPress={openResolverModal}
                disabled={busy}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: '#00695c', marginRight: 'auto' }}
                testID="smart-resolver-btn"
              >
                <Ionicons name="git-compare" size={13} color="#fff" />
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>🧩 حلحلة ذكية (بنقل محاضرات)</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={autoPlaceAll}
                disabled={busy}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: '#4527a0' }}
                testID="auto-place-all-btn"
              >
                <Ionicons name="flash" size={13} color="#fff" />
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>⚡ إدراج تلقائي للكل</Text>
              </TouchableOpacity>
              </>
            )}
          </View>
          <div style={{ overflowX: 'auto', direction: 'rtl' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: '#fff', borderRadius: 8 }}>
              <thead>
                <tr style={{ backgroundColor: '#ffe0b2' }}>
                  {['المقرر', 'المعلم', 'القسم', 'المستوى/الشعبة', 'المطلوب أسبوعياً', 'المدرج', 'الناقص'].map(h => (
                    <th key={h} style={{ padding: '6px 8px', fontSize: 11, color: '#6d4c00', textAlign: 'right', borderBottom: '1px solid #ffcc80' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {unscheduled.map((u: any, i: number) => {
                  const isPlacing = placing?.course_id === u.course_id && placing?.section === u.section && placing?.level === u.level;
                  return (
                  <tr
                    key={`${u.course_id}-${i}`}
                    onClick={() => togglePlacing(u)}
                    data-testid={`unscheduled-row-${u.course_id}`}
                    title={editMode ? (isPlacing ? 'انقر لإلغاء الإدراج' : 'انقر ليضيء لك الأماكن الصالحة في الجدول') : 'فعّل وضع التحرير أولاً للإدراج'}
                    style={{
                      backgroundColor: isPlacing ? '#e3f2fd' : i % 2 === 0 ? '#fffdf7' : '#fff',
                      cursor: editMode ? 'pointer' : 'default',
                      outline: isPlacing ? '2px solid #1565c0' : undefined, outlineOffset: -2,
                    }}
                  >
                    <td style={{ padding: '5px 8px', fontSize: 11.5, fontWeight: 700, color: '#333', borderBottom: '1px solid #f5ead2' }}>
                      {isPlacing ? '📌 ' : editMode ? '➕ ' : ''}{u.course_name}
                    </td>
                    <td style={{ padding: '5px 8px', fontSize: 11, color: '#555', borderBottom: '1px solid #f5ead2' }}>{u.teacher_name}</td>
                    <td style={{ padding: '5px 8px', fontSize: 11, color: '#555', borderBottom: '1px solid #f5ead2' }}>{u.department_name}</td>
                    <td style={{ padding: '5px 8px', fontSize: 11, color: '#555', borderBottom: '1px solid #f5ead2' }}>م{u.level}{u.section ? ` · ${u.section}` : ''}</td>
                    <td style={{ padding: '5px 8px', fontSize: 11, color: '#555', textAlign: 'center', borderBottom: '1px solid #f5ead2' }}>{u.needed}</td>
                    <td style={{ padding: '5px 8px', fontSize: 11, color: u.scheduled > 0 ? '#2e7d32' : '#999', textAlign: 'center', fontWeight: 700, borderBottom: '1px solid #f5ead2' }}>{u.scheduled}</td>
                    <td style={{ padding: '5px 8px', fontSize: 11, color: '#c62828', textAlign: 'center', fontWeight: 800, borderBottom: '1px solid #f5ead2' }}>{u.missing}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </View>
      )}
      {unscheduled.length === 0 && entries.length > 0 && (
        <View style={{ marginTop: 12, backgroundColor: '#e8f5e9', borderWidth: 1, borderColor: '#a5d6a7', borderRadius: 10, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="checkmark-circle" size={16} color="#2e7d32" />
          <Text style={{ fontSize: 12, color: '#2e7d32', fontWeight: '700' }}>✓ جميع المقررات مدرجة بالكامل في الجدول</Text>
        </View>
      )}
    </View>
  );
};
