import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { goBack } from '../src/utils/navigation';
import { hrAPI } from '../src/services/api';
import { useAuth } from '../src/contexts/AuthContext';
import { ReportHero, ReportKpis, ReportEmpty, reportPage } from '../src/components/reports/ReportShell';
import { Tabs, Badge, Th, td, table, btn, inp, Field, Modal, alertErr } from '../src/components/hr/ui';

const COLOR: Record<string, string> = { pending: '#f97316', approved: '#16a34a', rejected: '#dc2626', cancelled: '#64748b' };

/** نموذج الموظف: يعرض بياناته الحالية ويكتب الجديدة */
const RequestForm: React.FC<{ meta: any; onClose: () => void; onDone: (m: string) => void }> = ({ meta, onClose, onDone }) => {
  const [current, setCurrent] = useState<any>({});
  const [vals, setVals] = useState<any>({});
  useEffect(() => {
    hrAPI.myProfileReqs().then((r) => {
      if (!r.data.profile) { window.alert('لا يوجد ملف إداري مرتبط بحسابك'); onClose(); return; }
      if (r.data.has_pending) { window.alert('لديك طلب تعديل معلّق — انتظر قراره أو ألغِه أولاً'); onClose(); return; }
      setCurrent(r.data.current || {}); setVals({ ...(r.data.current || {}) });
    }).catch((e) => { alertErr(e); onClose(); });
  }, []);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const changed = Object.keys(meta?.fields || {}).filter((k) => String(vals[k] || '').trim() !== String(current[k] || '').trim());
  const submit = async () => {
    if (!changed.length) return window.alert('لم تغيّر أي بيانات');
    setBusy(true);
    try { await hrAPI.requestProfileChange({ changes: Object.fromEntries(changed.map((k) => [k, vals[k]])), note }); onDone('تم إرسال طلب التعديل'); } catch (e) { alertErr(e); } finally { setBusy(false); }
  };
  return (
    <Modal title="طلب تعديل بياناتي" onClose={onClose} width={620} testID="profile-request-form" busy={busy}>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>عدّل الحقول التي تريد تغييرها فقط — تُحفظ بعد اعتماد شؤون الموظفين.</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {Object.entries(meta?.fields || {}).map(([k, label]: any) => (
          <Field key={k} label={`${label}${current[k] ? ` (الحالي: ${current[k]})` : ''}`}>
            <input type={k.endsWith('_date') ? 'date' : 'text'} value={vals[k] || ''} onChange={(e) => setVals((p: any) => ({ ...p, [k]: e.target.value }))} style={{ ...inp, borderColor: changed.includes(k) ? '#f97316' : undefined }} data-testid={`profile-field-${k}`} />
          </Field>
        ))}
        <Field label="ملاحظة (اختياري)" span={2}><input value={note} onChange={(e) => setNote(e.target.value)} style={inp} data-testid="profile-note" /></Field>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button disabled={busy || !changed.length} onClick={submit} style={btn('#1565c0', '#fff', { opacity: changed.length ? 1 : 0.5 })} data-testid="profile-request-submit">إرسال الطلب ({changed.length} تغيير)</button>
        <button onClick={onClose} style={btn('#f1f5f9', '#0f2440')}>إلغاء</button>
      </div>
    </Modal>
  );
};

/** نافذة قرار HR: مقارنة قديم/جديد مع إمكانية تصحيح القيم */
const DecisionModal: React.FC<{ r: any; onClose: () => void; onDone: (m: string) => void }> = ({ r, onClose, onDone }) => {
  const [vals, setVals] = useState<any>({ ...r.changes });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<any>, m: string) => { setBusy(true); try { await fn(); onDone(m); } catch (e) { alertErr(e); } finally { setBusy(false); } };
  return (
    <Modal title={`طلب تعديل — ${r.employee_name}`} onClose={onClose} width={640} testID="profile-decision-modal" busy={busy}>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>{r.employee_no} · {r.org_unit_name || ''} · طُلب {(r.created_at || '').slice(0, 10)}{r.note ? ` · ملاحظة الموظف: ${r.note}` : ''}</div>
      <table style={table} data-testid="profile-changes-table">
        <Th cols={['الحقل', 'القيمة الحالية', 'القيمة المطلوبة (قابلة للتصحيح)']} />
        <tbody>{r.changes_view.map((c: any) => (
          <tr key={c.field} style={{ borderBottom: '1px solid #f1f5f9' }}>
            <td style={{ ...td, fontWeight: 700 }}>{c.label}</td>
            <td style={{ ...td, color: '#94a3b8' }}>{c.old || '—'}</td>
            <td style={td}>{r.status === 'pending' ? <input value={vals[c.field] ?? ''} onChange={(e) => setVals((p: any) => ({ ...p, [c.field]: e.target.value }))} style={{ ...inp, padding: '5px 8px' }} data-testid={`profile-new-${c.field}`} /> : <b style={{ color: '#0f2440' }}>{c.new}</b>}</td>
          </tr>))}</tbody>
      </table>
      {r.status === 'pending' ? (
        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, alignItems: 'end' }}>
          <Field label="سبب الرفض (عند الرفض)"><input value={note} onChange={(e) => setNote(e.target.value)} style={inp} data-testid="profile-decision-note" /></Field>
          <button disabled={busy} onClick={() => act(() => hrAPI.profileReqReject(r.id, note), 'تم رفض الطلب')} style={btn('#ffebee', '#c62828')} data-testid="profile-reject-btn">رفض</button>
          <button disabled={busy} onClick={() => act(() => hrAPI.profileReqApprove(r.id, note, vals), 'تم اعتماد التعديل وحفظه')} style={btn('#16a34a')} data-testid="profile-approve-btn">اعتماد وحفظ</button>
        </div>
      ) : <div style={{ marginTop: 10, fontSize: 12, color: '#475569' }}>{r.status_label}{r.decided_by_name ? ` — ${r.decided_by_name}` : ''}{r.decision_note ? ` · ${r.decision_note}` : ''}</div>}
    </Modal>
  );
};

export default function HrProfileRequests() {
  const { hasPermission, user } = useAuth();
  const isHr = user?.role === 'admin' || hasPermission('hr_view_employees') || hasPermission('hr_manage_employees');
  const canManage = user?.role === 'admin' || hasPermission('hr_manage_employees');
  const [meta, setMeta] = useState<any>(null);
  const [tab, setTab] = useState(isHr ? 'pending' : 'mine');
  const [data, setData] = useState<any>({ items: [], counts: {}, current: {} });
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<any>(null);
  const [form, setForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'mine') { const r = await hrAPI.myProfileReqs(); setData((p: any) => ({ ...p, items: r.data.items, current: r.data.current || {}, noProfile: !r.data.profile, hasPending: r.data.has_pending })); }
      else { const r = await hrAPI.profileReqs(tab === 'all' ? {} : { status: tab }); setData((p: any) => ({ ...p, ...r.data })); }
    } catch (e) { alertErr(e); } finally { setLoading(false); }
  }, [tab]);
  useEffect(() => { hrAPI.profileReqMeta().then((r) => setMeta(r.data)).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  const done = (m: string) => { window.alert(m); setSel(null); setForm(false); load(); };
  const c = data.counts || {};
  const tabs = [...(isHr ? [{ key: 'pending', label: 'بانتظار الاعتماد', count: c.pending }, { key: 'approved', label: 'معتمدة', count: c.approved }, { key: 'rejected', label: 'مرفوضة', count: c.rejected }, { key: 'all', label: 'الكل' }] : []), { key: 'mine', label: 'طلباتي' }];

  return (
    <SafeAreaView style={reportPage.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={reportPage.content}>
        <ReportHero kicker="شؤون الموظفين" title="طلبات تعديل البيانات" subtitle="الموظف يطلب تعديل هاتفه أو عنوانه أو مؤهله من التطبيق، ويُحفظ التعديل في ملفه بعد اعتماد شؤون الموظفين" onBack={() => goBack()} canExport={false} testID="hr-profile-hero" />
        {isHr && <ReportKpis items={[{ label: 'بانتظار الاعتماد', value: c.pending || 0, color: '#f97316', icon: 'hourglass' }, { label: 'معتمدة', value: c.approved || 0, color: '#16a34a', icon: 'checkmark-done' }, { label: 'مرفوضة', value: c.rejected || 0, color: '#dc2626', icon: 'close-circle' }]} />}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', direction: 'rtl', flexWrap: 'wrap', gap: 8 }}>
          <Tabs tabs={tabs} value={tab} onChange={setTab} testID="hr-profile-tabs" />
          <button onClick={() => setForm(true)} style={btn('#1565c0', '#fff', { marginBottom: 12 })} data-testid="profile-request-btn">✏️ طلب تعديل بياناتي</button>
        </div>
        {loading ? <Text style={{ textAlign: 'center', color: '#94a3b8', padding: 20 }}>جاري التحميل...</Text>
          : data.items.length === 0 ? <ReportEmpty text={tab === 'mine' && data.noProfile ? 'لا يوجد ملف إداري مرتبط بحسابك' : 'لا توجد طلبات'} icon="create-outline" />
          : (
            <View style={[reportPage.card, { padding: 0, overflow: 'hidden' }]}>
              <table style={table} data-testid="hr-profile-table">
                <Th cols={[...(tab !== 'mine' ? ['الموظف', 'الوحدة'] : []), 'الحقول', 'التاريخ', 'الحالة', '']} />
                <tbody>{data.items.map((r: any) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }} onClick={() => setSel(r)} data-testid={`profile-row-${r.id}`}>
                    {tab !== 'mine' && <td style={{ ...td, fontWeight: 700 }}>{r.employee_name} <span style={{ color: '#94a3b8', fontSize: 11 }}>({r.employee_no})</span></td>}
                    {tab !== 'mine' && <td style={td}>{r.org_unit_name || '—'}</td>}
                    <td style={td}>{r.changes_view.map((x: any) => x.label).join('، ')}</td>
                    <td style={td}>{(r.created_at || '').slice(0, 10)}</td>
                    <td style={td}><Badge color={COLOR[r.status]}>{r.status_label}</Badge></td>
                    <td style={td} onClick={(e) => e.stopPropagation()}>{tab === 'mine' && r.status === 'pending' && <button onClick={() => hrAPI.profileReqCancel(r.id).then(() => done('تم إلغاء الطلب')).catch(alertErr)} style={btn('#f1f5f9', '#0f2440', { padding: '4px 10px', fontSize: 11.5 })} data-testid={`profile-cancel-${r.id}`}>إلغاء</button>}</td>
                  </tr>))}</tbody>
              </table>
            </View>
          )}
      </ScrollView>
      {sel && (isHr && tab !== 'mine' ? <DecisionModal r={canManage ? sel : { ...sel, status: sel.status === 'pending' ? 'view' : sel.status, status_label: sel.status_label }} onClose={() => setSel(null)} onDone={done} /> : <DecisionModal r={{ ...sel, status: sel.status === 'pending' ? 'view' : sel.status }} onClose={() => setSel(null)} onDone={done} />)}
      {form && <RequestForm meta={meta} onClose={() => setForm(false)} onDone={done} />}
    </SafeAreaView>
  );
}
