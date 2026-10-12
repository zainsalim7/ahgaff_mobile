import React, { useState } from 'react';
import api from '../../services/api';
import { btn, inp, lbl, th, td, Badge } from '../corr/CorrUI';
import { STATUS_LABEL, STATUS_COLOR, ROUTE_LABEL, errOf } from './ExcuseSubmitForm';

const fmt = (iso?: string) => (iso ? iso.slice(0, 16).replace('T', ' ') : '—');
const kb = (n?: number) => (n ? `${Math.max(1, Math.round(n / 1024))} KB` : '');
const ACTION_AR: Record<string, string> = { submitted: 'تقديم', approved: 'اعتماد', rejected: 'رفض', needs_info: 'طلب استكمال', attachments_added: 'إضافة مرفقات', cancelled: 'إلغاء' };

/** تفاصيل طلب العذر + البت فيه (ويب) */
export const ExcuseDetail: React.FC<{ sel: any; token: string; onDecided: () => void }> = ({ sel, token, onDecided }) => {
  const [decision, setDecision] = useState<'approved' | 'rejected' | 'needs_info' | ''>(''); const [note, setNote] = useState('');
  const [sessNo, setSessNo] = useState(''); const [sessDate, setSessDate] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const base = (process.env.EXPO_PUBLIC_BACKEND_URL || process.env.REACT_APP_BACKEND_URL || '') + '/api';
  const attUrl = (a: any) => `${base}/student-excuses/${sel.id}/attachments/${a.idx}?token=${encodeURIComponent(token)}`;

  const decide = async () => {
    if (!decision) return;
    if (decision !== 'approved' && !note.trim()) { setErr('السبب/الملاحظة إلزامية'); return; }
    if (sel.route === 'board' && decision !== 'needs_info' && (!sessNo.trim() || !sessDate)) { setErr('رقم جلسة مجلس الكلية وتاريخها إلزاميان'); return; }
    setBusy(true); setErr('');
    try { const r = await api.post(`/student-excuses/${sel.id}/decide`, { decision, note: note.trim(), board_session_no: sessNo.trim(), board_session_date: sessDate }); window.alert(r.data.message); onDecided(); }
    catch (e) { setErr(errOf(e, 'فشل تسجيل القرار')); } finally { setBusy(false); }
  };

  return (
    <div style={{ direction: 'rtl' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, fontSize: 13 }}>
        <div><label style={lbl}>الحالة</label><Badge text={STATUS_LABEL[sel.status]} color={STATUS_COLOR[sel.status]} testID="se-detail-status" /></div>
        <div><label style={lbl}>المسار</label><b data-testid="se-detail-route">{ROUTE_LABEL[sel.route]}</b></div>
        <div><label style={lbl}>نوع العذر</label>{sel.excuse_type_label}</div>
        <div><label style={lbl}>الطالب</label>{sel.student?.full_name} · {sel.student?.student_id}</div>
        <div><label style={lbl}>القسم / المستوى</label>{sel.department_name || '—'} · م{sel.student?.level}/{sel.student?.section}</div>
        <div><label style={lbl}>الفترة</label><b>{sel.from_date}</b> → <b>{sel.to_date}</b> ({sel.days} يوم)</div>
        <div><label style={lbl}>المقرر</label>{sel.course_name || 'كل المقررات'}</div>
        <div><label style={lbl}>قدّمه</label>{sel.submitted_by_name} ({sel.submitted_by_role === 'student' ? 'الطالب' : 'الإدارة'})</div>
        <div><label style={lbl}>تاريخ التقديم</label>{fmt(sel.created_at)}</div>
      </div>
      <label style={{ ...lbl, marginTop: 10 }}>الوصف</label>
      <div style={{ background: '#f8fafc', borderRadius: 8, padding: 10, fontSize: 13, whiteSpace: 'pre-wrap' }} data-testid="se-detail-desc">{sel.description || '—'}</div>
      <label style={{ ...lbl, marginTop: 10 }}>المستندات ({(sel.attachments || []).length})</label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {(sel.attachments || []).map((a: any) => (
          <a key={a.idx} href={attUrl(a)} target="_blank" rel="noreferrer" style={{ display: 'flex', flexDirection: 'column', gap: 4, border: '1px solid #e2e8f0', borderRadius: 10, padding: 8, textDecoration: 'none', color: '#0f2440', width: 150 }} data-testid={`se-att-${a.idx}`}>
            {String(a.mime || '').startsWith('image/') ? <img src={attUrl(a)} alt={a.name} style={{ width: '100%', height: 90, objectFit: 'cover', borderRadius: 6 }} /> : <div style={{ height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fef2f2', borderRadius: 6, fontWeight: 800, color: '#b91c1c' }}>PDF</div>}
            <span style={{ fontSize: 11.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.name}>{a.name}</span><span style={{ fontSize: 10.5, color: '#64748b' }}>{kb(a.size)} · فتح ↗</span>
          </a>
        ))}
      </div>
      {sel.applied && <div style={{ marginTop: 10, background: '#ecfdf5', borderRadius: 8, padding: 10, fontSize: 12.5 }} data-testid="se-detail-applied"><b>أثر الاعتماد:</b> {sel.applied.lectures} محاضرة منفَّذة ضمن الفترة — حُوّل {sel.applied.updated + sel.applied.created} غياب إلى «بعذر»{sel.applied.courses?.length ? ` (${sel.applied.courses.join('، ')})` : ''}</div>}
      {sel.decided_by_name && <div style={{ marginTop: 10, background: '#f1f5f9', borderRadius: 8, padding: 10, fontSize: 12.5 }} data-testid="se-detail-decision"><b>القرار:</b> {sel.decided_by_name} · {fmt(sel.decided_at)}{sel.decision_note ? ` — ${sel.decision_note}` : ''}{sel.board_session_no ? ` · جلسة مجلس الكلية رقم ${sel.board_session_no} بتاريخ ${sel.board_session_date}` : ''}</div>}
      {(sel.history || []).length > 1 && <details style={{ marginTop: 8, fontSize: 12 }}><summary style={{ cursor: 'pointer', fontWeight: 700 }}>سجل الطلب</summary>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}><tbody>{sel.history.map((h: any, i: number) => <tr key={i}><td style={td}>{fmt(h.at)}</td><td style={td}>{ACTION_AR[h.action] || h.action}</td><td style={td}>{h.by_name}</td><td style={td}>{h.note || ''}</td></tr>)}</tbody></table></details>}
      {sel.can_decide && (
        <div style={{ marginTop: 14, borderTop: '2px solid #e2e8f0', paddingTop: 12 }} data-testid="se-decide">
          <label style={lbl}>القرار ({ROUTE_LABEL[sel.route]})</label>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {([['approved', 'اعتماد', '#16a34a'], ['rejected', 'رفض', '#b91c1c'], ['needs_info', 'طلب استكمال', '#6d28d9']] as const).map(([k, l, c]) => <button key={k} onClick={() => setDecision(k)} style={btn(decision === k ? c : '#f1f5f9', { color: decision === k ? '#fff' : '#0f2440' })} data-testid={`se-decision-${k}`}>{l}</button>)}
          </div>
          {sel.route === 'board' && decision && decision !== 'needs_info' && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div><label style={lbl}>رقم جلسة مجلس الكلية</label><input style={inp} value={sessNo} onChange={(e) => setSessNo(e.target.value)} data-testid="se-board-no" /></div>
            <div><label style={lbl}>تاريخ الجلسة</label><input type="date" style={inp} value={sessDate} onChange={(e) => setSessDate(e.target.value)} data-testid="se-board-date" /></div>
          </div>}
          <textarea style={{ ...inp, minHeight: 60 }} placeholder={decision === 'approved' ? 'ملاحظة (اختياري)' : 'السبب / الملاحظة (إلزامي)'} value={note} onChange={(e) => setNote(e.target.value)} data-testid="se-decide-note" />
          {!!err && <div style={{ color: '#b91c1c', fontWeight: 700, marginTop: 6, fontSize: 12.5 }} data-testid="se-decide-error">{err}</div>}
          <button onClick={decide} disabled={!decision || busy} style={btn('#0f2440', { marginTop: 8, opacity: !decision || busy ? 0.6 : 1 })} data-testid="se-decide-submit">{busy ? 'جاري الحفظ…' : 'تسجيل القرار'}</button>
        </div>
      )}
    </div>
  );
};

export const excuseTableHeaders = ['الرقم', 'الطالب', 'القسم', 'النوع', 'الفترة', 'المسار', 'المرفقات', 'التقديم', 'الحالة', ''];
export { th, td, fmt };
