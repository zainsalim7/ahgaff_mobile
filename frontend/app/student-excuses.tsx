import React, { useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../src/services/api';
import { CorrPage, card, btn, inp, Badge, Modal, Empty } from '../src/components/corr/CorrUI';
import { ExcuseSubmitForm, STATUS_LABEL, STATUS_COLOR, ROUTE_LABEL, errOf } from '../src/components/excuses/ExcuseSubmitForm';
import { ExcuseDetail, excuseTableHeaders, th, td, fmt } from '../src/components/excuses/ExcuseDetail';

const STATUS_TABS = [['pending', 'قيد المراجعة'], ['needs_info', 'مطلوب استكمال'], ['approved', 'المعتمدة'], ['rejected', 'المرفوضة'], ['', 'الكل']] as const;

export default function StudentExcusesPage() {
  const [items, setItems] = useState<any[]>([]); const [pendingByRoute, setPendingByRoute] = useState<Record<string, number>>({});
  const [status, setStatus] = useState('pending'); const [route, setRoute] = useState(''); const [q, setQ] = useState('');
  const [sel, setSel] = useState<any>(null); const [showForm, setShowForm] = useState(false);
  const [err, setErr] = useState(''); const [loading, setLoading] = useState(true); const [token, setToken] = useState(''); const [meta, setMeta] = useState<any>(null);

  const load = () => {
    setLoading(true);
    api.get('/student-excuses', { params: { status: status || undefined, route: route || undefined, q: q.trim() || undefined } })
      .then((r) => { setItems(r.data.items || []); setPendingByRoute(r.data.pending_by_route || {}); })
      .catch((e) => setErr(errOf(e, 'غير مصرح بالوصول إلى أعذار الطلاب'))).finally(() => setLoading(false));
  };
  useEffect(load, [status, route]); // eslint-disable-line
  useEffect(() => { AsyncStorage.getItem('token').then((t) => setToken(t || '')); api.get('/student-excuses/meta').then((r) => setMeta(r.data)).catch(() => {}); }, []);

  const open = async (it: any) => { setErr(''); try { const r = await api.get(`/student-excuses/${it.id}`); setSel(r.data); } catch (e) { setErr(errOf(e, 'تعذر فتح الطلب')); } };
  const totalPending = useMemo(() => Object.values(pendingByRoute).reduce((a, b) => a + b, 0), [pendingByRoute]);

  return (
    <CorrPage title="📄 أعذار غياب الطلاب" subtitle={meta?.rule || 'طلبات الأعذار بوثيقة — تُوجَّه حسب النوع والمدة إلى التسجيل أو العميد أو مجلس الكلية. الاعتماد يحوّل الغياب ضمن الفترة إلى «بعذر».'} testID="se-page" hideNav
      actions={<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {STATUS_TABS.map(([k, l]) => <button key={k} onClick={() => setStatus(k)} style={btn(status === k ? '#0f2440' : '#f1f5f9', { color: status === k ? '#fff' : '#0f2440' })} data-testid={`se-filter-${k || 'all'}`}>{l}{k === 'pending' && totalPending ? ` (${totalPending})` : ''}</button>)}
        <button onClick={() => setShowForm(true)} style={btn('#16a34a')} data-testid="se-new-btn">+ تقديم عذر نيابةً عن طالب</button>
      </div>}>
      {!!err && !sel && <div style={{ ...card, color: '#b91c1c', fontWeight: 700 }} data-testid="se-error">{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, direction: 'rtl' }} data-testid="se-route-cards">
        {Object.entries(ROUTE_LABEL).map(([k, l]) => (
          <div key={k} onClick={() => setRoute(route === k ? '' : k)} style={{ ...card, flex: 1, marginBottom: 0, cursor: 'pointer', textAlign: 'center', borderColor: route === k ? '#0f2440' : '#e6eaf0', borderWidth: 2 }} data-testid={`se-route-${k}`}>
            <div style={{ fontSize: 12, color: '#64748b' }}>بانتظار {l}</div><div style={{ fontSize: 24, fontWeight: 900, color: '#0f2440' }}>{pendingByRoute[k] || 0}</div>
          </div>
        ))}
      </div>
      <div style={card} data-testid="se-list">
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
          <input style={{ ...inp, width: 260 }} placeholder="بحث بالاسم / رقم القيد / رقم الطلب" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} data-testid="se-search" />
          <button onClick={load} style={btn('#f1f5f9', { color: '#0f2440', padding: '6px 10px', fontSize: 12 })} data-testid="se-refresh">↻ تحديث</button>
          <span style={{ fontSize: 12, color: '#64748b' }} data-testid="se-count">{items.length} طلب</span>
        </div>
        {loading ? <div style={{ color: '#94a3b8', fontSize: 13 }}>جاري التحميل…</div> : items.length === 0 ? <Empty text="لا توجد طلبات في هذا التصنيف" /> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{excuseTableHeaders.map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
            <tbody>{items.map((it) => (
              <tr key={it.id} data-testid={`se-row-${it.id}`}>
                <td style={{ ...td, fontWeight: 800 }}>{it.ref_no}</td>
                <td style={td}>{it.student?.full_name}<div style={{ fontSize: 10.5, color: '#64748b' }}>{it.student?.student_id} · م{it.student?.level}/{it.student?.section}</div></td>
                <td style={td}>{it.department_name || '—'}</td><td style={td}>{it.excuse_type_label}</td>
                <td style={td}>{it.from_date} → {it.to_date}<div style={{ fontSize: 10.5, color: '#64748b' }}>{it.days} يوم{it.course_name ? ` · ${it.course_name}` : ''}</div></td>
                <td style={td}>{it.route_label}</td><td style={td}>{(it.attachments || []).length}</td><td style={td}>{fmt(it.created_at)}</td>
                <td style={td}><Badge text={STATUS_LABEL[it.status]} color={STATUS_COLOR[it.status]} /></td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}><button onClick={() => open(it)} style={btn(it.can_decide ? '#0f2440' : '#64748b', { padding: '5px 10px', fontSize: 12 })} data-testid={`se-open-${it.id}`}>{it.can_decide ? 'مراجعة' : 'التفاصيل'}</button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {sel && <Modal title={`طلب ${sel.ref_no} — ${sel.student?.full_name}`} onClose={() => setSel(null)} width={840} testID="se-detail"><ExcuseDetail sel={sel} token={token} onDecided={() => { setSel(null); load(); }} /></Modal>}
      {showForm && <Modal title="تقديم عذر غياب نيابةً عن طالب" onClose={() => setShowForm(false)} width={720} testID="se-form-modal"><ExcuseSubmitForm onDone={() => { setShowForm(false); setStatus('pending'); load(); }} onClose={() => setShowForm(false)} /></Modal>}
    </CorrPage>
  );
}
