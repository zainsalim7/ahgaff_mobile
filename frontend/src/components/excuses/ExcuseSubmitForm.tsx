import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { card, btn, inp, lbl } from '../corr/CorrUI';

export const TYPE_LABEL: Record<string, string> = { sick: 'مرضي', family: 'ظرف عائلي', official: 'مهمة/تكليف رسمي', exam: 'عذر عن اختبار', other: 'أخرى' };
export const ROUTE_LABEL: Record<string, string> = { registration: 'التسجيل', dean: 'عميد الكلية', board: 'مجلس الكلية' };
export const STATUS_LABEL: Record<string, string> = { pending: 'قيد المراجعة', approved: 'معتمد', rejected: 'مرفوض', needs_info: 'مطلوب استكمال', cancelled: 'ملغى' };
export const STATUS_COLOR: Record<string, string> = { pending: '#d97706', approved: '#16a34a', rejected: '#b91c1c', needs_info: '#6d28d9', cancelled: '#64748b' };
export const errOf = (e: any, d: string) => e?.response?.data?.detail || d;

export const routeFor = (type: string, days: number) => (type === 'sick' ? 'registration' : type === 'exam' || days > 2 ? 'board' : 'dean');
export const daysBetween = (a: string, b: string) => (a && b ? Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86400000) + 1 : 0);

/** نموذج تقديم عذر نيابةً عن طالب (ويب — الإدارة/التسجيل) */
export const ExcuseSubmitForm: React.FC<{ onDone: () => void; onClose: () => void }> = ({ onDone, onClose }) => {
  const [q, setQ] = useState(''); const [results, setResults] = useState<any[]>([]); const [student, setStudent] = useState<any>(null);
  const [form, setForm] = useState({ from_date: '', to_date: '', excuse_type: 'sick', description: '', course_id: '' });
  const [files, setFiles] = useState<File[]>([]); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const days = daysBetween(form.from_date, form.to_date);

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => api.get('/student-excuses/students/search', { params: { q: q.trim() } }).then((r) => setResults(r.data)).catch(() => setResults([])), 300);
    return () => clearTimeout(t);
  }, [q]);

  const submit = async () => {
    setErr('');
    if (!student) { setErr('اختر الطالب'); return; }
    if (!form.from_date || !form.to_date) { setErr('حدد الفترة'); return; }
    if (!files.length) { setErr('المستند إلزامي'); return; }
    const fd = new FormData();
    Object.entries({ ...form, student_db_id: student.id }).forEach(([k, v]) => v && fd.append(k, String(v)));
    files.forEach((f) => fd.append('files', f));
    setBusy(true);
    try { const r = await api.post('/student-excuses', fd, { headers: { 'Content-Type': 'multipart/form-data' } }); window.alert(r.data.message); onDone(); }
    catch (e) { setErr(errOf(e, 'فشل إرسال الطلب')); } finally { setBusy(false); }
  };

  return (
    <div style={{ direction: 'rtl' }} data-testid="se-form">
      <label style={lbl}>الطالب</label>
      {student ? (
        <div style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 10 }} data-testid="se-form-student">
          <span style={{ fontWeight: 800 }}>{student.full_name} <span style={{ color: '#64748b', fontWeight: 500 }}>· {student.student_id} · م{student.level}/{student.section}</span></span>
          <button onClick={() => { setStudent(null); setForm({ ...form, course_id: '' }); }} style={btn('#f1f5f9', { color: '#0f2440', padding: '4px 10px' })} data-testid="se-form-change-student">تغيير</button>
        </div>
      ) : (
        <>
          <input style={inp} placeholder="ابحث بالاسم أو رقم القيد…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="se-form-search" />
          {results.length > 0 && <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, marginTop: 4, maxHeight: 180, overflow: 'auto' }}>
            {results.map((s) => <div key={s.id} onClick={() => { setStudent(s); setResults([]); setQ(''); }} style={{ padding: 8, cursor: 'pointer', borderBottom: '1px solid #f1f5f9', fontSize: 13 }} data-testid={`se-form-result-${s.student_id}`}>{s.full_name} · {s.student_id} · م{s.level}/{s.section}</div>)}
          </div>}
        </>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 10 }}>
        <div><label style={lbl}>من تاريخ</label><input type="date" style={inp} value={form.from_date} onChange={(e) => setForm({ ...form, from_date: e.target.value })} data-testid="se-form-from" /></div>
        <div><label style={lbl}>إلى تاريخ</label><input type="date" style={inp} value={form.to_date} onChange={(e) => setForm({ ...form, to_date: e.target.value })} data-testid="se-form-to" /></div>
        <div><label style={lbl}>نوع العذر</label><select style={inp} value={form.excuse_type} onChange={(e) => setForm({ ...form, excuse_type: e.target.value })} data-testid="se-form-type">{Object.entries(TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      </div>
      <div style={{ marginTop: 8 }}><label style={lbl}>المقرر (اختياري — افتراضياً كل المقررات)</label>
        <select style={inp} value={form.course_id} onChange={(e) => setForm({ ...form, course_id: e.target.value })} disabled={!student} data-testid="se-form-course"><option value="">كل مقررات الطالب</option>{(student?.courses || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      <div style={{ marginTop: 8 }}><label style={lbl}>الوصف</label><textarea style={{ ...inp, minHeight: 60 }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="se-form-desc" /></div>
      <div style={{ marginTop: 8 }}><label style={lbl}>المستندات (PDF/صور، حتى 3 ملفات × 5MB) — إلزامي</label><input type="file" multiple accept="application/pdf,image/*" onChange={(e) => setFiles(Array.from(e.target.files || []).slice(0, 3))} data-testid="se-form-files" /></div>
      {days > 0 && <div style={{ marginTop: 10, background: '#eef3f9', borderRadius: 8, padding: 10, fontSize: 12.5 }} data-testid="se-form-route">المدة: <b>{days}</b> يوم — سيُوجَّه الطلب إلى: <b>{ROUTE_LABEL[routeFor(form.excuse_type, days)]}</b></div>}
      {!!err && <div style={{ color: '#b91c1c', fontWeight: 700, marginTop: 8, fontSize: 12.5 }} data-testid="se-form-error">{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button onClick={submit} disabled={busy} style={btn('#0f2440')} data-testid="se-form-submit">{busy ? 'جاري الإرسال…' : 'إرسال الطلب'}</button>
        <button onClick={onClose} style={btn('#f1f5f9', { color: '#0f2440' })} data-testid="se-form-cancel">إلغاء</button>
      </div>
    </div>
  );
};
