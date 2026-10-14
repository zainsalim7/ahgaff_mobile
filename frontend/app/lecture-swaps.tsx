import React, { useEffect, useState } from 'react';
import { Platform, Alert } from 'react-native';
import api from '../src/services/api';
import { CorrPage, card, btn, inp, lbl, Badge, Modal, Empty } from '../src/components/corr/CorrUI';

const notify = (t: string, m: string) => (Platform.OS === 'web' ? window.alert(`${t}\n${m}`) : Alert.alert(t, m));
const STATUS: Record<string, [string, string]> = {
  pending_counterpart: ['بانتظار موافقة الزميل', '#f59e0b'], pending_head: ['بانتظار اعتماد رئيس القسم', '#6366f1'], approved: ['معتمد ومطبّق', '#16a34a'],
  executed: ['نُفّذ', '#0f766e'], rejected_counterpart: ['رفضه الزميل', '#dc2626'], rejected_head: ['رفضه رئيس القسم', '#dc2626'], cancelled: ['ملغى', '#64748b'], expired: ['انتهت صلاحيته', '#94a3b8'],
};
const lecTxt = (l: any) => l ? `${l.course_name || ''}${l.group_name ? ` (${l.group_name})` : ''} — ${l.date} ${l.start_time || ''}` : '';

export default function LectureSwapsScreen() {
  const [items, setItems] = useState<any[]>([]);
  const [counts, setCounts] = useState({ pending_decision: 0, pending_response: 0 });
  const [mine, setMine] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [type, setType] = useState<'swap' | 'cover'>('swap');
  const [lectureA, setLectureA] = useState('');
  const [cands, setCands] = useState<any>(null);
  const [cp, setCp] = useState('');
  const [lectureB, setLectureB] = useState('');
  const [reason, setReason] = useState('');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [r1, r2] = await Promise.all([api.get('/lecture-swaps', { params: filter ? { status: filter } : {} }), api.get('/lecture-swaps/my-lectures').catch(() => ({ data: null }))]);
      setItems(r1.data.items); setCounts({ pending_decision: r1.data.pending_decision, pending_response: r1.data.pending_response }); setMine(r2.data);
    } catch (e: any) { notify('خطأ', e?.response?.data?.detail || 'تعذر التحميل'); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [filter]);
  useEffect(() => {
    if (!lectureA) { setCands(null); return; }
    setCp(''); setLectureB('');
    api.get('/lecture-swaps/candidates', { params: { lecture_id: lectureA, type } }).then((r) => setCands(r.data)).catch((e) => notify('خطأ', e?.response?.data?.detail || 'تعذر جلب الزملاء'));
  }, [lectureA, type]);

  const act = async (path: string, body: any, okMsg: string) => {
    setBusy(true);
    try { await api.post(path, body); notify('تم ✅', okMsg); setShowNew(false); setLectureA(''); setReason(''); await load(); }
    catch (e: any) { notify('تعذر', e?.response?.data?.detail || 'خطأ'); } finally { setBusy(false); }
  };
  const ask = (q: string) => (Platform.OS === 'web' ? window.prompt(q, '') : '');
  const selTeacher = cands?.teachers?.find((t: any) => t.teacher_id === cp);
  const canSubmit = !!lectureA && !!cp && (type === 'cover' || !!lectureB) && !busy;

  return (
    <CorrPage title="🔁 تبادل / إنابة المحاضرات" subtitle="تبادل محاضرة مقابل محاضرة (أو إنابة) بين أستاذين داخل الأسبوع نفسه ولمرة واحدة — بموافقة الزميل ثم اعتماد رئيس القسم." loading={loading} testID="lecture-swaps-page" hideNav
      actions={mine ? <button onClick={() => setShowNew(true)} style={btn('#00838f')} data-testid="swap-new-btn">＋ طلب تبادل/إنابة</button> : undefined}>
      {mine && (
        <div style={{ ...card, display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12.5 }} data-testid="swap-my-summary">
          <span>استخدامك هذا الشهر: <b>{mine.month_used}</b> / {mine.settings.monthly_limit}</span>
          <span>المهلة الدنيا: <b>{mine.settings.min_hours}</b> ساعة قبل المحاضرة</span>
          {counts.pending_response > 0 && <Badge text={`${counts.pending_response} طلب بانتظار ردك`} color="#f59e0b" />}
          {counts.pending_decision > 0 && <Badge text={`${counts.pending_decision} طلب بانتظار اعتمادك`} color="#6366f1" />}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap', direction: 'rtl' }}>
        {[['', 'الكل'], ['pending_counterpart,pending_head', 'المعلّقة'], ['approved,executed', 'المعتمدة'], ['rejected_counterpart,rejected_head,cancelled,expired', 'المرفوضة/الملغاة']].map(([v, l]) => (
          <button key={v} onClick={() => setFilter(v)} style={btn(filter === v ? '#1a2540' : '#94a3b8')} data-testid={`swap-filter-${v || 'all'}`}>{l}</button>
        ))}
      </div>
      {items.length === 0 && <Empty text="لا توجد طلبات" />}
      {items.map((s) => (
        <div key={s.id} style={card} data-testid={`swap-item-${s.id}`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Badge text={STATUS[s.status]?.[0] || s.status} color={STATUS[s.status]?.[1] || '#64748b'} testID={`swap-status-${s.id}`} />
            <b style={{ fontSize: 13 }}>{s.type === 'swap' ? '🔁 تبادل' : '🤝 إنابة'} — {s.requester_name} ↔ {s.counterpart_name}{s.cross_department ? ' · بين قسمين' : ''}</b>
          </div>
          <div style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.9 }}>
            <div>📘 محاضرة {s.requester_name}: <b>{lecTxt(s.lecture_a)}</b> ← ينفّذها <b>{s.counterpart_name}</b></div>
            {s.lecture_b && <div>📗 محاضرة {s.counterpart_name}: <b>{lecTxt(s.lecture_b)}</b> ← ينفّذها <b>{s.requester_name}</b></div>}
            {s.reason ? <div style={{ color: '#475569' }}>السبب: {s.reason}</div> : null}
            <div style={{ color: '#94a3b8', fontSize: 11 }}>{(s.approvals || []).map((a: any) => `${a.step === 'request' ? 'طلب' : a.step === 'counterpart' ? 'الزميل' : a.step === 'head' ? 'الاعتماد' : 'إلغاء'}: ${a.name || ''}${a.accept === false ? ' (رفض)' : ''}${a.note ? ` — ${a.note}` : ''}`).join(' · ')}</div>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {s.can_respond && <><button disabled={busy} onClick={() => act(`/lecture-swaps/${s.id}/respond`, { accept: true }, 'تمت موافقتك')} style={btn('#16a34a')} data-testid={`swap-accept-${s.id}`}>✓ أوافق</button>
              <button disabled={busy} onClick={() => act(`/lecture-swaps/${s.id}/respond`, { accept: false, note: ask('سبب الاعتذار (اختياري)') || '' }, 'تم الاعتذار')} style={btn('#dc2626')} data-testid={`swap-decline-${s.id}`}>✗ أعتذر</button></>}
            {s.can_decide && <><button disabled={busy} onClick={() => act(`/lecture-swaps/${s.id}/decide`, { accept: true }, 'تم الاعتماد والتطبيق على المحاضرتين')} style={btn('#6366f1')} data-testid={`swap-approve-${s.id}`}>✓ اعتماد</button>
              <button disabled={busy} onClick={() => act(`/lecture-swaps/${s.id}/decide`, { accept: false, note: ask('سبب الرفض') || '' }, 'تم الرفض')} style={btn('#dc2626')} data-testid={`swap-reject-${s.id}`}>✗ رفض</button></>}
            {s.can_cancel && <button disabled={busy} onClick={() => { if (Platform.OS !== 'web' || window.confirm('إلغاء الطلب؟ إن كان معتمداً ستعود المحاضرتان لأصحابهما.')) act(`/lecture-swaps/${s.id}/cancel`, { accept: false, note: '' }, 'تم الإلغاء'); }} style={btn('#64748b')} data-testid={`swap-cancel-${s.id}`}>↩ إلغاء</button>}
          </div>
        </div>
      ))}

      {showNew && mine && (
        <Modal title="طلب تبادل / إنابة محاضرة" onClose={() => setShowNew(false)} width={720} testID="swap-new-modal">
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <button onClick={() => setType('swap')} style={btn(type === 'swap' ? '#00838f' : '#94a3b8')} data-testid="swap-type-swap">🔁 تبادل (محاضرة مقابل محاضرة)</button>
            {mine.settings.allow_cover && <button onClick={() => setType('cover')} style={btn(type === 'cover' ? '#00838f' : '#94a3b8')} data-testid="swap-type-cover">🤝 إنابة (بدون مقابل)</button>}
          </div>
          <label style={lbl}>محاضرتي التي أريد {type === 'swap' ? 'تبادلها' : 'الإنابة عنها'}</label>
          <select value={lectureA} onChange={(e: any) => setLectureA(e.target.value)} style={inp} data-testid="swap-lecture-a">
            <option value="">-- اختر المحاضرة --</option>
            {mine.lectures.map((l: any) => <option key={l.id} value={l.id} disabled={!l.eligible}>{lecTxt(l)}{!l.eligible ? ` — ${l.reason}` : ''}</option>)}
          </select>
          {cands && (
            <>
              <label style={{ ...lbl, marginTop: 10 }}>الزميل (الأسبوع {cands.week[0]} → {cands.week[1]}) — المتاحون وقت محاضرتك أولاً</label>
              <select value={cp} onChange={(e: any) => { setCp(e.target.value); setLectureB(''); }} style={inp} data-testid="swap-counterpart">
                <option value="">-- اختر الزميل --</option>
                {cands.teachers.map((t: any) => <option key={t.teacher_id} value={t.teacher_id} disabled={!t.available}>{t.available ? '✓ ' : '✗ '}{t.full_name}{!t.available ? ` — ${t.busy_reason}` : ''}</option>)}
              </select>
              {type === 'swap' && selTeacher && (
                <>
                  <label style={{ ...lbl, marginTop: 10 }}>محاضرة الزميل التي سأنفّذها بالمقابل</label>
                  {selTeacher.swappable.length === 0 ? <div style={{ fontSize: 12, color: '#b91c1c' }}>لا توجد محاضرات قابلة للتبادل لهذا الزميل في الأسبوع نفسه</div> : (
                    <select value={lectureB} onChange={(e: any) => setLectureB(e.target.value)} style={inp} data-testid="swap-lecture-b">
                      <option value="">-- اختر --</option>
                      {selTeacher.swappable.map((l: any) => <option key={l.id} value={l.id} disabled={!l.ok}>{l.ok ? '✓ ' : '✗ '}{lecTxt(l)}{!l.ok ? ` — ${l.conflict}` : ''}</option>)}
                    </select>
                  )}
                </>
              )}
            </>
          )}
          <label style={{ ...lbl, marginTop: 10 }}>السبب</label>
          <textarea value={reason} onChange={(e: any) => setReason(e.target.value)} rows={2} style={{ ...inp, resize: 'vertical' }} placeholder="مثال: ارتباط رسمي / ظرف طارئ" data-testid="swap-reason" />
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 8, lineHeight: 1.8 }}>⚠️ التبادل لمرة واحدة ولا يُعاد تبادل المحاضرة نفسها · يلزم موافقة الزميل ثم اعتماد رئيس القسم (أو العميد عند اختلاف القسمين) · يُشعَر الطلاب تلقائياً عند الاعتماد · الحضور يسجّله المنفّذ الفعلي وتُنسب الساعات إليه.</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={() => setShowNew(false)} style={btn('#94a3b8', { flex: 1 })}>إلغاء</button>
            <button disabled={!canSubmit} onClick={() => act('/lecture-swaps', { type, lecture_a_id: lectureA, counterpart_teacher_id: cp, lecture_b_id: type === 'swap' ? lectureB : undefined, reason }, 'أُرسل الطلب إلى الزميل')} style={btn(canSubmit ? '#00838f' : '#9fb3b6', { flex: 2 })} data-testid="swap-submit">إرسال الطلب</button>
          </div>
        </Modal>
      )}
    </CorrPage>
  );
}
