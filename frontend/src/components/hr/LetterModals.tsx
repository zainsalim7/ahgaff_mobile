import React, { useEffect, useState } from 'react';
import { hrAPI } from '../../services/api';
import { Modal, Field, inp, btn, opt, alertErr, Badge } from './ui';

export const LETTER_STATUS_COLOR: Record<string, string> = { pending: '#f97316', approved: '#16a34a', rejected: '#dc2626', cancelled: '#64748b' };

export const downloadLetter = async (id: string, name: string) => {
  try {
    const r = await hrAPI.letterPdf(id);
    const url = URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }));
    const a = document.createElement('a'); a.href = url; a.download = `${name}.pdf`; a.click(); URL.revokeObjectURL(url);
  } catch (e) { alertErr(e); }
};

/** 📜 تفاصيل طلب خطاب: تعديل النص قبل الإصدار، اعتماد/رفض، تحميل PDF */
export const LetterDetailModal: React.FC<{ id: string; canManage: boolean; onClose: () => void; onDone: (msg: string) => void }> = ({ id, canManage, onClose, onDone }) => {
  const [l, setL] = useState<any>(null);
  const [body, setBody] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { hrAPI.letter(id).then((r) => { setL(r.data); setBody(r.data.body || r.data.draft_body || ''); }).catch(alertErr); }, [id]);
  if (!l) return null;
  const act = async (fn: () => Promise<any>, msg: string) => { setBusy(true); try { await fn(); onDone(msg); } catch (e) { alertErr(e); } finally { setBusy(false); } };
  const info: [string, any][] = [['الموظف', `${l.employee_name || ''} (${l.employee_no || ''})`], ['الوحدة', l.org_unit_name], ['النوع', l.type_label], ['اللغة', l.language_label], ['الجهة الموجّه إليها', l.addressed_to || '—'], ['الغرض', l.purpose || '—'], ['تاريخ الطلب', (l.created_at || '').slice(0, 10)]];
  if (l.status === 'approved') info.push(['الرقم المرجعي', l.ref_no], ['تاريخ الإصدار', l.issue_date], ['اعتمده', l.approved_by_name]);
  if (l.status === 'rejected') info.push(['سبب الرفض', l.decision_note], ['رفضه', l.decided_by_name]);
  return (
    <Modal title={`${l.type_label} — ${l.employee_name || ''}`} onClose={onClose} width={720} testID="letter-detail-modal" busy={busy}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <Badge color={LETTER_STATUS_COLOR[l.status]} testID="letter-detail-status">{l.status_label}</Badge>
        {l.status === 'approved' && <button onClick={() => downloadLetter(l.id, `${l.type_label}-${l.ref_no}`)} style={btn('#0f2440')} data-testid="letter-detail-pdf">⬇️ تحميل PDF</button>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 12.5, color: '#334155', marginBottom: 12 }}>
        {info.map(([k, v]) => <div key={k}><b style={{ color: '#64748b' }}>{k}:</b> {v || '—'}</div>)}
      </div>
      <Field label={l.status === 'pending' && canManage ? 'نص الخطاب (يمكنك تعديله قبل الإصدار — النص المقترح مولَّد من بيانات الموظف)' : 'نص الخطاب'}>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} readOnly={!(l.status === 'pending' && canManage)} rows={11} style={{ ...inp, direction: l.language === 'en' ? 'ltr' : 'rtl', textAlign: l.language === 'en' ? 'left' : 'right', fontFamily: 'inherit', lineHeight: 1.7, resize: 'vertical' }} data-testid="letter-body" />
      </Field>
      {l.status === 'pending' && canManage && (
        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, alignItems: 'end' }}>
          <Field label="سبب الرفض (عند الرفض فقط)"><input value={note} onChange={(e) => setNote(e.target.value)} style={inp} placeholder="مثال: بيانات العقد غير محدثة" data-testid="letter-reject-note" /></Field>
          <button disabled={busy} onClick={() => act(() => hrAPI.letterReject(l.id, note), 'تم رفض الطلب')} style={btn('#ffebee', '#c62828')} data-testid="letter-reject-btn">رفض</button>
          <button disabled={busy} onClick={() => act(() => hrAPI.letterApprove(l.id, body), 'تم اعتماد الخطاب وإصداره')} style={btn('#16a34a')} data-testid="letter-approve-btn">اعتماد وإصدار PDF</button>
        </div>
      )}
      {l.status === 'pending' && !canManage && <button disabled={busy} onClick={() => act(() => hrAPI.letterCancel(l.id), 'تم إلغاء الطلب')} style={btn('#f1f5f9', '#0f2440', { marginTop: 10 })} data-testid="letter-cancel-btn">إلغاء طلبي</button>}
    </Modal>
  );
};

/** 📜 نموذج طلب/إصدار خطاب — للموظف (طلب) أو HR (إصدار مباشر مع اختيار الموظف) */
export const LetterFormModal: React.FC<{ meta: any; direct: boolean; onClose: () => void; onDone: (msg: string) => void }> = ({ meta, direct, onClose, onDone }) => {
  const [f, setF] = useState<any>({ employee_id: '', type: 'introduction', language: 'ar', addressed_to: '', purpose: '' });
  const [emps, setEmps] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (direct) hrAPI.employees({ per_page: 500, status: 'active,probation,leave' }).then((r) => setEmps(r.data.employees || [])).catch(() => {}); }, [direct]);
  const set = (k: string) => (e: any) => setF((p: any) => ({ ...p, [k]: e.target.value }));
  const submit = async () => {
    if (direct && !f.employee_id) return window.alert('اختر الموظف');
    if (f.type === 'addressed' && !f.addressed_to.trim()) return window.alert('حدد الجهة الموجّه إليها الخطاب');
    setBusy(true);
    try { await (direct ? hrAPI.issueLetter(f) : hrAPI.requestLetter(f)); onDone(direct ? 'تم إصدار الخطاب' : 'تم إرسال طلبك'); } catch (e) { alertErr(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={direct ? 'إصدار خطاب رسمي مباشر' : 'طلب خطاب رسمي'} onClose={onClose} width={560} testID="letter-form-modal" busy={busy}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {direct && <Field label="الموظف" span={2}><select value={f.employee_id} onChange={set('employee_id')} style={inp} data-testid="letter-employee"><option value="">— اختر —</option>{emps.map((e) => <option key={e.id} value={e.id}>{e.full_name} ({e.employee_no}){e.job_title ? ` — ${e.job_title}` : ''}</option>)}</select></Field>}
        <Field label="نوع الخطاب"><select value={f.type} onChange={set('type')} style={inp} data-testid="letter-type">{opt(meta?.types)}</select></Field>
        <Field label="اللغة"><select value={f.language} onChange={set('language')} style={inp} data-testid="letter-language">{opt(meta?.languages)}</select></Field>
        <Field label={f.type === 'addressed' ? 'الجهة الموجّه إليها (إلزامي)' : 'الجهة الموجّه إليها (اختياري — وإلا: إلى من يهمه الأمر)'} span={2}><input value={f.addressed_to} onChange={set('addressed_to')} style={inp} placeholder="مثال: سفارة ماليزيا / بنك التضامن" data-testid="letter-addressed-to" /></Field>
        <Field label="الغرض (اختياري — يُذكر في نص الخطاب)" span={2}><input value={f.purpose} onChange={set('purpose')} style={inp} placeholder="مثال: استكمال إجراءات فتح حساب" data-testid="letter-purpose" /></Field>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-start', marginTop: 14 }}>
        <button disabled={busy} onClick={submit} style={btn('#1565c0')} data-testid="letter-form-submit">{direct ? 'إصدار الآن' : 'إرسال الطلب'}</button>
        <button onClick={onClose} style={btn('#f1f5f9', '#0f2440')}>إلغاء</button>
      </div>
    </Modal>
  );
};
