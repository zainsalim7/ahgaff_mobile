import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { goBack } from '../src/utils/navigation';
import { hrAPI } from '../src/services/api';
import { useAuth } from '../src/contexts/AuthContext';
import { ReportHero, ReportKpis, ReportEmpty, reportPage } from '../src/components/reports/ReportShell';
import { EmployeeFormModal, Portal, inp, btn } from '../src/components/hr/EmployeeFormModal';
import { EmployeeDocuments } from '../src/components/hr/EmployeeDocuments';
import { AccountRoleModal } from '../src/components/hr/AccountRoleModal';
import { BulkToolbar } from '../src/components/hr/BulkToolbar';
import { EmployeePhotoPanel } from '../src/components/hr/EmployeePhotoPanel';

const STATUS_COLOR: Record<string, string> = { active: '#16a34a', probation: '#f97316', leave: '#0284c7', suspended: '#dc2626', ended: '#64748b' };

export default function HrEmployees() {
  const router = useRouter();
  const sp = useLocalSearchParams<{ category?: string; org_unit_id?: string; status?: string }>();
  const { hasPermission, user } = useAuth();
  const canManage = user?.role === 'admin' || hasPermission('hr_manage_employees');
  const [meta, setMeta] = useState<any>(null);
  const [acct, setAcct] = useState<{ emp: any; mode: 'create' | 'change' } | null>(null);
  const [sel, setSel] = useState<Record<string, string>>({});
  const [exporting, setExporting] = useState(false);
  const [units, setUnits] = useState<any[]>([]);
  const [data, setData] = useState<any>({ employees: [], total: 0, stats: {} });
  const [q, setQ] = useState({ search: '', org_unit_id: String(sp.org_unit_id || ''), category: String(sp.category || ''), status: String(sp.status || ''), contract_type: '', page: 1 });
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<{ open: boolean; emp: any | null }>({ open: false, emp: null });
  const [detail, setDetail] = useState<any>(null);
  const [importState, setImportState] = useState<{ file: File | null; preview: any | null; busy: boolean }>({ file: null, preview: null, busy: false });
  const [showImport, setShowImport] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await hrAPI.employees({ ...Object.fromEntries(Object.entries(q).filter(([, v]) => v)), per_page: 30 });
      setData(r.data);
    } catch { setData({ employees: [], total: 0, stats: {} }); }
    finally { setLoading(false); }
  }, [q]);

  useEffect(() => {
    hrAPI.meta().then((r) => setMeta(r.data)).catch(() => {});
    hrAPI.orgUnits().then((r) => setUnits(r.data.units || [])).catch(() => {});
  }, []);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const setQ1 = (k: string) => (e: any) => setQ((p) => ({ ...p, [k]: e.target.value, page: 1 }));
  const opt = (m: Record<string, string>) => Object.entries(m || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>);
  const alertMsg = (e: any) => window.alert(typeof e?.response?.data?.detail === 'string' ? e.response.data.detail : 'حدث خطأ');

  const openDetail = async (id: string) => { try { setDetail((await hrAPI.employee(id)).data); } catch (e) { alertMsg(e); } };
  const linkUnits = async () => { const force = window.confirm('ربط المعلمين بوحدات أقسامهم/كلياتهم.\n«موافق» = إعادة الربط للجميع وفق بيانات المعلم · «إلغاء» = ربط من لا وحدة له فقط'); try { const r = await hrAPI.linkUnits(force); window.alert(r.data.message + (r.data.unresolved?.length ? '\n\nبلا وحدة: ' + r.data.unresolved.map((u: any) => `${u.name} (${u.reason})`).join('، ') : '')); load(); } catch (e) { alertMsg(e); } };
  const syncTeachers = async () => { if (!window.confirm('إنشاء ملف إداري لكل معلم ليس له ملف؟')) return; try { const r = await hrAPI.syncTeachers(); window.alert(r.data.message); load(); } catch (e) { alertMsg(e); } };
  const createAccount = (emp: any) => setAcct({ emp, mode: 'create' });
  const remove = async (emp: any) => { const msg = emp.teacher_id ? `حذف الملف الإداري للمعلم ${emp.full_name}؟\nيبقى سجله الأكاديمي في شاشة المعلمين، ويمكن استعادة الملف من سلة المحذوفات.` : `حذف الموظف ${emp.full_name}؟ (يمكن استعادته من سلة المحذوفات، ويُعطَّل حسابه)`; if (!window.confirm(msg)) return; try { const r = await hrAPI.deleteEmployee(emp.id, !!emp.teacher_id); window.alert(r.data.message); setDetail(null); load(); } catch (e) { alertMsg(e); } };
  const exportXlsx = async () => { setExporting(true); try { const r = await hrAPI.exportEmployees(Object.fromEntries(Object.entries(q).filter(([k, v]) => v && k !== 'page'))); const url = URL.createObjectURL(r.data); const a = document.createElement('a'); a.href = url; a.download = 'سجل الموظفين.xlsx'; a.click(); URL.revokeObjectURL(url); } catch (e) { alertMsg(e); } finally { setExporting(false); } };
  const toggleSel = (e: any) => setSel((p) => { const n = { ...p }; if (n[e.id]) delete n[e.id]; else n[e.id] = e.full_name; return n; });
  const allSel = data.employees.length > 0 && data.employees.every((e: any) => sel[e.id]);
  const toggleAll = () => setSel((p) => { const n = { ...p }; if (allSel) data.employees.forEach((e: any) => delete n[e.id]); else data.employees.forEach((e: any) => { n[e.id] = e.full_name; }); return n; });
  const downloadTemplate = async () => {
    try {
      const res = await (await import('../src/services/api')).default.get('/hr/employees/import/template', { responseType: 'blob' });
      const url = URL.createObjectURL(res.data); const a = document.createElement('a'); a.href = url; a.download = 'نموذج استيراد الموظفين.xlsx'; a.click(); URL.revokeObjectURL(url);
    } catch (e) { alertMsg(e); }
  };
  const pickFile = () => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.xlsx'; i.onchange = async (e: any) => { const file = e.target.files?.[0]; if (!file) return; setImportState({ file, preview: null, busy: true }); try { const fd = new FormData(); fd.append('file', file); const r = await hrAPI.importPreview(fd); setImportState({ file, preview: r.data, busy: false }); } catch (err) { alertMsg(err); setImportState({ file: null, preview: null, busy: false }); } }; i.click(); };
  const runImport = async () => { if (!importState.file) return; setImportState((p) => ({ ...p, busy: true })); try { const fd = new FormData(); fd.append('file', importState.file); const r = await hrAPI.importRun(fd); window.alert(r.data.message); setShowImport(false); setImportState({ file: null, preview: null, busy: false }); load(); } catch (e) { alertMsg(e); setImportState((p) => ({ ...p, busy: false })); } };

  const st = data.stats || {};
  return (
    <SafeAreaView style={reportPage.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={reportPage.content}>
        <ReportHero kicker="شؤون الموظفين" title="سجل الموظفين" subtitle="الملف الإداري الموحّد لأعضاء هيئة التدريس والموظفين الإداريين" onBack={() => goBack()} canExport={false} testID="hr-employees-hero" />

        {canManage && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, direction: 'rtl' }}>
            <button onClick={() => setForm({ open: true, emp: null })} style={btn('#1565c0')} data-testid="hr-add-employee-btn">+ إضافة موظف</button>
            <button onClick={() => setShowImport(true)} style={btn('#0f2440')} data-testid="hr-import-btn">📥 استيراد من Excel</button>
            <button onClick={syncTeachers} style={btn('#e3f2fd', '#1565c0')} data-testid="hr-sync-teachers-btn">🔄 مزامنة المعلمين</button>
            <button onClick={linkUnits} style={btn('#ede9fe', '#6d28d9')} data-testid="hr-link-units-btn">🔗 ربط المعلمين بوحداتهم</button>
            <button onClick={() => router.push('/hr-org-units')} style={btn('#f1f5f9', '#0f2440')} data-testid="hr-goto-org-btn">🏢 الهيكل التنظيمي</button>
            <button onClick={exportXlsx} disabled={exporting} style={btn('#1b5e20')} data-testid="hr-export-btn">{exporting ? '...' : '📊 تصدير Excel'}</button>
          </div>
        )}
        {canManage && Object.keys(sel).length > 0 && <BulkToolbar ids={Object.keys(sel)} names={Object.values(sel)} meta={meta} units={units} onDone={load} onClear={() => setSel({})} />}

        <ReportKpis items={[
          { label: 'إجمالي الموظفين', value: st.total || 0, color: '#1565c0', icon: 'people' },
          { label: 'أكاديميون', value: st.by_category?.academic || 0, color: '#7c3aed', icon: 'school' },
          { label: 'إداريون وفنيون', value: (st.by_category?.administrative || 0) + (st.by_category?.technical || 0) + (st.by_category?.service || 0), color: '#0f2440', icon: 'briefcase' },
          { label: 'على رأس العمل', value: st.by_status?.active || 0, color: '#16a34a', icon: 'checkmark-circle' },
          { label: 'في إجازة / موقوف', value: (st.by_status?.leave || 0) + (st.by_status?.suspended || 0), color: '#f97316', icon: 'pause-circle' },
        ]} />

        <View style={reportPage.card}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.4fr 1fr 1fr 1fr', gap: 8, direction: 'rtl' }}>
            <input placeholder="بحث بالاسم / الرقم الوظيفي / المسمى / الهاتف" value={q.search} onChange={setQ1('search')} style={inp} data-testid="hr-search-input" />
            <select value={q.org_unit_id} onChange={setQ1('org_unit_id')} style={inp} data-testid="hr-filter-unit"><option value="">كل الوحدات</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
            <select value={q.category} onChange={setQ1('category')} style={inp} data-testid="hr-filter-category"><option value="">كل الفئات</option>{opt(meta?.categories)}</select>
            <select value={q.status} onChange={setQ1('status')} style={inp} data-testid="hr-filter-status"><option value="">كل الحالات</option>{opt(meta?.statuses)}</select>
            <select value={q.contract_type} onChange={setQ1('contract_type')} style={inp} data-testid="hr-filter-contract"><option value="">كل أنواع التعاقد</option>{opt(meta?.contract_types)}</select>
          </div>
        </View>

        {loading ? <Text style={{ textAlign: 'center', color: '#94a3b8', padding: 20 }}>جاري التحميل...</Text>
          : data.employees.length === 0 ? <ReportEmpty text="لا يوجد موظفون مطابقون — ابدأ بإضافة موظف أو مزامنة المعلمين أو الاستيراد من Excel" icon="people-outline" />
          : (
            <View style={[reportPage.card, { padding: 0, overflow: 'hidden' }]}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, direction: 'rtl' }} data-testid="hr-employees-table">
                <thead><tr style={{ backgroundColor: '#0f2440', color: '#fff' }}>{canManage && <th style={{ padding: '10px 8px', width: 34 }}><input type="checkbox" checked={allSel} onChange={toggleAll} data-testid="hr-select-all" /></th>}{['الرقم', 'الاسم', 'الفئة', 'المسمى', 'الوحدة', 'التعاقد', 'الحالة', 'حساب', ''].map((h) => <th key={h} style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 700 }}>{h}</th>)}</tr></thead>
                <tbody>
                  {data.employees.map((e: any) => (
                    <tr key={e.id} style={{ borderBottom: '1px solid #eef2f7', cursor: 'pointer', backgroundColor: sel[e.id] ? '#eff6ff' : undefined }} onClick={() => openDetail(e.id)} data-testid={`hr-emp-row-${e.id}`}>
                      {canManage && <td style={{ padding: '9px 8px' }} onClick={(ev) => ev.stopPropagation()}><input type="checkbox" checked={!!sel[e.id]} onChange={() => toggleSel(e)} data-testid={`hr-select-${e.id}`} /></td>}
                      <td style={{ padding: '9px 8px', fontWeight: 700, color: '#475569' }}>{e.employee_no}</td>
                      <td style={{ padding: '9px 8px', fontWeight: 700, color: '#0f2440' }}>{e.full_name}{e.alerts?.length ? <span title={e.alerts.join(' · ')} style={{ marginRight: 6, color: '#dc2626' }}>⚠</span> : null}</td>
                      <td style={{ padding: '9px 8px' }}>{e.category_label}</td>
                      <td style={{ padding: '9px 8px', color: '#475569' }}>{e.job_title || '—'}</td>
                      <td style={{ padding: '9px 8px', color: '#475569' }}>{e.org_unit_name || '—'}</td>
                      <td style={{ padding: '9px 8px', color: '#475569' }}>{e.contract_type_label}</td>
                      <td style={{ padding: '9px 8px' }}><span style={{ backgroundColor: (STATUS_COLOR[e.status] || '#64748b') + '18', color: STATUS_COLOR[e.status] || '#64748b', padding: '3px 8px', borderRadius: 10, fontWeight: 700, fontSize: 11.5 }}>{e.status_label}</span></td>
                      <td style={{ padding: '9px 8px' }}>{e.has_account ? '✅' : '—'}</td>
                      <td style={{ padding: '9px 8px', whiteSpace: 'nowrap' }} onClick={(ev) => ev.stopPropagation()}>
                        {canManage && <button onClick={() => setForm({ open: true, emp: e })} style={btn('#e3f2fd', '#1565c0', { padding: '5px 10px', fontSize: 11.5 })} data-testid={`hr-edit-${e.id}`}>تعديل</button>}
                        {canManage && <button onClick={() => remove(e)} title="حذف" style={btn('transparent', '#c62828', { padding: '5px 6px', fontSize: 12 })} data-testid={`hr-delete-${e.id}`}>🗑</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 10, direction: 'rtl', fontSize: 12, color: '#64748b' }}>
                <span data-testid="hr-total">الإجمالي: {data.total}</span>
                <span style={{ display: 'flex', gap: 6 }}>
                  <button disabled={q.page <= 1} onClick={() => setQ((p) => ({ ...p, page: p.page - 1 }))} style={btn('#f1f5f9', '#0f2440', { padding: '5px 12px', fontSize: 12 })}>السابق</button>
                  <span style={{ padding: '5px 8px' }}>صفحة {q.page} من {Math.max(1, Math.ceil(data.total / 30))}</span>
                  <button disabled={q.page >= Math.ceil(data.total / 30)} onClick={() => setQ((p) => ({ ...p, page: p.page + 1 }))} style={btn('#f1f5f9', '#0f2440', { padding: '5px 12px', fontSize: 12 })}>التالي</button>
                </span>
              </div>
            </View>
          )}
      </ScrollView>

      <EmployeeFormModal open={form.open} employee={form.emp} meta={meta} units={units} onClose={() => setForm({ open: false, emp: null })} onSaved={() => { load(); if (detail && form.emp?.id) openDetail(form.emp.id); }} />

      {detail && (<Portal>
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', justifyContent: 'flex-start', direction: 'rtl' }} onClick={() => setDetail(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: '95%', height: '100%', backgroundColor: '#fff', overflowY: 'auto', padding: 20, boxShadow: '-4px 0 24px rgba(0,0,0,0.2)' }} data-testid="hr-employee-detail">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div><div style={{ fontSize: 17, fontWeight: 800, color: '#0f2440' }}>{detail.full_name}</div><div style={{ fontSize: 12, color: '#64748b' }}>{detail.employee_no} · {detail.category_label}{detail.job_title ? ` · ${detail.job_title}` : ''}</div></div>
              <button onClick={() => setDetail(null)} style={btn('#f1f5f9', '#0f2440', { padding: '4px 10px' })} data-testid="hr-detail-close">✕</button>
            </div>
            <span style={{ backgroundColor: (STATUS_COLOR[detail.status] || '#64748b') + '18', color: STATUS_COLOR[detail.status], padding: '3px 10px', borderRadius: 10, fontWeight: 700, fontSize: 12 }}>{detail.status_label}</span>
            {detail.alerts?.map((a: string) => <div key={a} style={{ marginTop: 8, backgroundColor: '#fff3e0', color: '#e65100', padding: '6px 10px', borderRadius: 8, fontSize: 12, fontWeight: 700 }}>⚠ {a}</div>)}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 14, fontSize: 12.5 }}>
              {[['الوحدة', detail.org_unit_name], ['المدير المباشر', detail.manager_name], ['نوع التعاقد', detail.contract_type_label], ['تاريخ التعيين', detail.hire_date], ['نهاية العقد', detail.contract_end_date], ['الدرجة', detail.grade], ['الهاتف', detail.phone], ['البريد', detail.email], ['الجنسية', detail.nationality], ['الهوية', detail.national_id], ['انتهاء الهوية', detail.id_expiry_date], ['المؤهل', detail.qualification], ['التخصص', detail.specialization], ['تاريخ الميلاد', detail.birth_date]].map(([l, v]) => (
                <div key={l as string} style={{ backgroundColor: '#f7f9fc', borderRadius: 8, padding: '7px 10px' }}><div style={{ fontSize: 10.5, color: '#94a3b8' }}>{l}</div><div style={{ fontWeight: 700, color: '#0f2440' }}>{v || '—'}</div></div>
              ))}
            </div>
            {detail.teacher && <div style={{ marginTop: 10, backgroundColor: '#ede9fe', color: '#5b21b6', padding: '8px 10px', borderRadius: 8, fontSize: 12 }}>🎓 عضو هيئة تدريس · الرقم الأكاديمي {detail.teacher.teacher_id} · {detail.teacher.courses_count} مقرر نشط</div>}
            {detail.subordinates?.length > 0 && <div style={{ marginTop: 12 }}><div style={{ fontSize: 12, fontWeight: 800, color: '#5b6678', marginBottom: 4 }}>يرأس ({detail.subordinates.length})</div>{detail.subordinates.map((s: any) => <div key={s.id} style={{ fontSize: 12, padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}>{s.full_name}{s.job_title ? ` — ${s.job_title}` : ''}</div>)}</div>}
            {detail.notes && <div style={{ marginTop: 10, fontSize: 12, color: '#475569', backgroundColor: '#fafafa', padding: 8, borderRadius: 8 }}>{detail.notes}</div>}
            {detail.has_account && <div style={{ marginTop: 10, fontSize: 12.5, backgroundColor: '#f3e8ff', color: '#4c1d95', padding: '8px 10px', borderRadius: 8, textAlign: 'right' }} data-testid="hr-detail-role">حساب الدخول: <b>{detail.account_username}</b> · الدور: <b>{detail.role_name || 'موظف (خدمة ذاتية فقط)'}</b></div>}
            <EmployeePhotoPanel employeeId={detail.id} canManage={canManage} />
            <EmployeeDocuments employeeId={detail.id} canManage={canManage} />
            {canManage && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 16 }}>
                <button onClick={() => setForm({ open: true, emp: detail })} style={btn('#1565c0')} data-testid="hr-detail-edit">تعديل</button>
                {!detail.has_account && !detail.teacher_id && <button onClick={() => createAccount(detail)} style={btn('#16a34a')} data-testid="hr-detail-create-account">إنشاء حساب دخول</button>}
                {detail.has_account && <button onClick={() => setAcct({ emp: detail, mode: 'change' })} style={btn('#ede9fe', '#6d28d9')} data-testid="hr-detail-change-role">تغيير الدور</button>}
                <button onClick={() => remove(detail)} style={btn('#ffebee', '#c62828')} data-testid="hr-detail-delete">{detail.teacher_id ? 'حذف الملف الإداري' : 'حذف'}</button>
              </div>
            )}
            {detail.history?.length > 0 && <div style={{ marginTop: 16 }}><div style={{ fontSize: 12, fontWeight: 800, color: '#5b6678', marginBottom: 4 }}>سجل التغييرات</div>{detail.history.map((h: any) => <div key={h.id} style={{ fontSize: 11.5, color: '#475569', padding: '5px 0', borderBottom: '1px solid #f1f5f9' }}><b>{{ created: 'إنشاء الملف', updated: 'تعديل', account_created: 'إنشاء حساب', role_changed: 'تغيير الدور' }[h.action as string] || h.action}</b> · {h.by_name} · {String(h.at).slice(0, 16).replace('T', ' ')}{h.details && Object.keys(h.details).length ? <div style={{ color: '#94a3b8' }}>{Object.entries(h.details).map(([k, v]: any) => `${k}: ${v?.from ?? '—'} → ${v?.to ?? '—'}`).join(' · ')}</div> : null}</div>)}</div>}
          </div>
        </div>
      </Portal>)}

      {showImport && (<Portal>
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, backgroundColor: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', direction: 'rtl' }} onClick={() => !importState.busy && setShowImport(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: '#fff', borderRadius: 14, padding: 22, width: 640, maxWidth: '95%', maxHeight: '88vh', overflowY: 'auto' }} data-testid="hr-import-modal">
            <div style={{ fontSize: 16, fontWeight: 800, color: '#0f2440', marginBottom: 6 }}>📥 استيراد الموظفين من Excel</div>
            <div style={{ fontSize: 12, color: '#5b6678', lineHeight: 1.7, marginBottom: 12 }}>حمّل النموذج، املأه (الرقم الوظيفي والاسم إلزاميان، الوحدة التنظيمية بالاسم كما في الهيكل)، ثم ارفعه. الأرقام الوظيفية الموجودة تُحدَّث، والجديدة تُضاف.</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button onClick={downloadTemplate} style={btn('#f1f5f9', '#0f2440')} data-testid="hr-import-template-btn">⬇ تحميل النموذج</button>
              <button onClick={pickFile} disabled={importState.busy} style={btn('#1565c0')} data-testid="hr-import-pick-btn">{importState.busy ? 'جاري الفحص...' : '📂 اختيار الملف'}</button>
            </div>
            {importState.preview && (
              <div data-testid="hr-import-preview">
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  {[['صفوف', importState.preview.total, '#0f2440'], ['جديد', importState.preview.new, '#16a34a'], ['تحديث', importState.preview.updates, '#0284c7'], ['أخطاء', importState.preview.invalid, '#dc2626']].map(([l, v, c]: any) => <div key={l} style={{ flex: 1, textAlign: 'center', backgroundColor: '#f7f9fc', borderRadius: 8, padding: 8 }}><div style={{ fontSize: 18, fontWeight: 800, color: c }}>{v}</div><div style={{ fontSize: 11, color: '#64748b' }}>{l}</div></div>)}
                </div>
                <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid #eee', borderRadius: 8 }}>
                  <table style={{ width: '100%', fontSize: 11.5, borderCollapse: 'collapse' }}><thead><tr style={{ backgroundColor: '#f1f5f9' }}><th style={{ padding: 6 }}>#</th><th style={{ padding: 6, textAlign: 'right' }}>الرقم</th><th style={{ padding: 6, textAlign: 'right' }}>الاسم</th><th style={{ padding: 6, textAlign: 'right' }}>الوحدة</th><th style={{ padding: 6, textAlign: 'right' }}>النتيجة</th></tr></thead>
                    <tbody>{importState.preview.rows.map((r: any) => <tr key={r.row} style={{ borderTop: '1px solid #f1f5f9', color: r.errors.length ? '#c62828' : '#0f2440' }}><td style={{ padding: 5, textAlign: 'center' }}>{r.row}</td><td style={{ padding: 5 }}>{r.data.employee_no}</td><td style={{ padding: 5 }}>{r.data.full_name}</td><td style={{ padding: 5 }}>{r.data.org_unit_name || '—'}</td><td style={{ padding: 5 }}>{r.errors.length ? r.errors.join('، ') : r.exists ? 'تحديث' : 'جديد'}</td></tr>)}</tbody></table>
                </div>
                <button onClick={runImport} disabled={importState.busy || !importState.preview.valid} style={btn('#16a34a', '#fff', { width: '100%', marginTop: 12 })} data-testid="hr-import-run-btn">{importState.busy ? 'جاري الاستيراد...' : `✅ استيراد ${importState.preview.valid} صفاً صالحاً`}</button>
              </div>
            )}
          </div>
        </div>
      </Portal>)}
      {acct && <AccountRoleModal employee={acct.emp} mode={acct.mode} onClose={() => setAcct(null)} onDone={(m) => { window.alert(m); load(); openDetail(acct.emp.id); }} />}
    </SafeAreaView>
  );
}
