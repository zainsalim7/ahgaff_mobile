import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { goBack } from '../src/utils/navigation';
import api, { hrAPI } from '../src/services/api';
import { useAuth } from '../src/contexts/AuthContext';
import { ReportHero, ReportEmpty, reportPage } from '../src/components/reports/ReportShell';
import { btn, alertErr } from '../src/components/hr/ui';

const useImg = (id: string, which: 'approved' | 'pending', enabled: boolean) => {
  const [src, setSrc] = useState('');
  useEffect(() => { if (!enabled) return; api.get(`/hr/employees/${id}/photo?which=${which}`, { responseType: 'blob' }).then((r) => setSrc(URL.createObjectURL(r.data))).catch(() => setSrc('')); }, [id, which, enabled]);
  return src;
};

const Card: React.FC<{ e: any; selected: boolean; onToggle: () => void; onAct: (a: 'approve' | 'reject') => void; busy: boolean }> = ({ e, selected, onToggle, onAct, busy }) => {
  const pending = useImg(e.id, 'pending', true);
  const approved = useImg(e.id, 'approved', !!e.has_photo);
  return (
    <div style={{ backgroundColor: '#fff', borderRadius: 14, padding: 12, border: selected ? '2px solid #1565c0' : '1px solid #e2e8f0', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }} data-testid={`photo-card-${e.id}`}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 8 }}>
        <input type="checkbox" checked={selected} onChange={onToggle} data-testid={`photo-select-${e.id}`} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: '#0f2440' }}>{e.full_name}</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>{e.employee_no}{e.job_title ? ` · ${e.job_title}` : ''} · رُفعت {(e.pending_photo_at || '').slice(0, 10)}</div>
        </div>
      </label>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 110, height: 140, borderRadius: 10, overflow: 'hidden', backgroundColor: '#eef2f7', border: '2px solid #f97316' }}>{pending ? <img src={pending} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}</div>
          <div style={{ fontSize: 10.5, color: '#f97316', fontWeight: 700, marginTop: 3 }}>المعلّقة</div>
        </div>
        {e.has_photo && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: 110, height: 140, borderRadius: 10, overflow: 'hidden', backgroundColor: '#eef2f7', border: '1px solid #e2e8f0' }}>{approved ? <img src={approved} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}</div>
            <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 3 }}>المعتمدة حالياً</div>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 10 }}>
        <button disabled={busy} onClick={() => onAct('approve')} style={btn('#16a34a', '#fff', { padding: '5px 14px', fontSize: 12 })} data-testid={`photo-approve-${e.id}`}>اعتماد</button>
        <button disabled={busy} onClick={() => onAct('reject')} style={btn('#ffebee', '#c62828', { padding: '5px 14px', fontSize: 12 })} data-testid={`photo-reject-${e.id}`}>رفض</button>
      </div>
    </div>
  );
};

/** 🖼️ اعتماد صور البطاقات المعلّقة — فردي أو جماعي */
export default function HrPhotoApprovals() {
  const { hasPermission, user } = useAuth();
  const canManage = user?.role === 'admin' || hasPermission('hr_manage_employees');
  const [items, setItems] = useState<any[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await hrAPI.pendingPhotos();
      const withInfo = await Promise.all((r.data.items || []).map(async (e: any) => { try { const c = (await hrAPI.card(e.id)).data; return { ...e, has_photo: c.has_photo }; } catch { return e; } }));
      setItems(withInfo); setSel(new Set());
    } catch (e) { alertErr(e); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (ids: string[], action: 'approve' | 'reject') => {
    if (!ids.length) return;
    if (!window.confirm(`${action === 'approve' ? 'اعتماد' : 'رفض'} ${ids.length} صورة؟`)) return;
    setBusy(true);
    try { const r = await hrAPI.bulkPhotos(ids, action); window.alert(r.data.message); await load(); } catch (e) { alertErr(e); } finally { setBusy(false); }
  };
  const toggle = (id: string) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSel = items.length > 0 && sel.size === items.length;

  return (
    <SafeAreaView style={reportPage.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={reportPage.content}>
        <ReportHero kicker="شؤون الموظفين" title="اعتماد صور البطاقات" subtitle="الصور التي رفعها الموظفون من التطبيق — تظهر على البطاقة الرقمية بعد اعتمادك. الرفض يفتح للموظف فرصة رفع صورة جديدة." onBack={() => goBack()} canExport={false} testID="hr-photos-hero" />
        {canManage && items.length > 0 && (
          <View style={[reportPage.card, { marginBottom: 12 }]}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, direction: 'rtl', flexWrap: 'wrap' }} data-testid="photo-bulk-toolbar">
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: '#0f2440', cursor: 'pointer' }}>
                <input type="checkbox" checked={allSel} onChange={() => setSel(allSel ? new Set() : new Set(items.map((i) => i.id)))} data-testid="photo-select-all" /> تحديد الكل ({items.length})
              </label>
              <span style={{ color: '#64748b', fontSize: 12 }}>المحدد: <b data-testid="photo-selected-count">{sel.size}</b></span>
              <button disabled={busy || !sel.size} onClick={() => act([...sel], 'approve')} style={btn('#16a34a', '#fff', { opacity: sel.size ? 1 : 0.5 })} data-testid="photo-bulk-approve">✔ اعتماد المحدد</button>
              <button disabled={busy || !sel.size} onClick={() => act([...sel], 'reject')} style={btn('#ffebee', '#c62828', { opacity: sel.size ? 1 : 0.5 })} data-testid="photo-bulk-reject">✖ رفض المحدد</button>
            </div>
          </View>
        )}
        {loading ? <Text style={{ textAlign: 'center', color: '#94a3b8', padding: 20 }}>جاري التحميل...</Text>
          : items.length === 0 ? <ReportEmpty text="لا توجد صور بانتظار الاعتماد" icon="images-outline" />
          : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, direction: 'rtl' }} data-testid="photo-grid">
              {items.map((e) => <Card key={e.id} e={e} selected={sel.has(e.id)} onToggle={() => toggle(e.id)} onAct={(a) => act([e.id], a)} busy={busy || !canManage} />)}
            </div>}
      </ScrollView>
    </SafeAreaView>
  );
}
