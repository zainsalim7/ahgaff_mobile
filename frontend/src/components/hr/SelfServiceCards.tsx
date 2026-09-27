import React, { useEffect, useState, useCallback } from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { hrAPI } from '../../services/api';
import { reportPage } from '../reports/ReportShell';
import { Badge, btn, alertErr, fmtDT, ATT_COLOR, CORR_COLOR } from './ui';
import { DocRow } from './EmployeeDocuments';

export const MyAttendanceCard: React.FC = () => {
  const [d, setD] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setD((await hrAPI.myAttendance()).data); } catch { setD(null); } }, []);
  useEffect(() => { load(); }, [load]);
  if (!d?.profile) return null;
  const act = async (fn: () => Promise<any>) => { setBusy(true); try { const r = await fn(); window.alert(r.data.message); load(); } catch (e) { alertErr(e); } finally { setBusy(false); } };
  const c = d.counts || {};
  return (
    <View style={reportPage.card} testID="hr-me-attendance">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', direction: 'rtl', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#0f2440' }}>حضوري اليوم — {d.day_name} {d.date}</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            {!d.is_work_day ? (d.holiday || 'عطلة أسبوعية') : d.on_leave ? `أنت في إجازة ${d.on_leave}` : d.today ? <>حضور <b>{d.today.check_in}</b>{d.today.check_out ? <> · انصراف <b>{d.today.check_out}</b></> : null}{d.today.late_minutes ? <span style={{ color: '#f97316' }}> · تأخير {d.today.late_minutes} د</span> : null}</> : `الدوام ${d.settings.work_start} – ${d.settings.work_end} (سماحية ${d.settings.late_grace_minutes} د)`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {d.today && <Badge color={ATT_COLOR[d.today.status]} testID="hr-me-today-status">{d.today.status_label}</Badge>}
          {d.can_check_in && <button onClick={() => act(hrAPI.checkIn)} disabled={busy} style={btn('#16a34a')} data-testid="hr-me-checkin-btn">🕐 تسجيل حضور</button>}
          {d.can_check_out && <button onClick={() => act(hrAPI.checkOut)} disabled={busy} style={btn('#0f2440')} data-testid="hr-me-checkout-btn">🏁 تسجيل انصراف</button>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 10, direction: 'rtl', flexWrap: 'wrap', fontSize: 11.5 }}>
        <span style={{ color: '#64748b' }}>هذا الشهر:</span>
        <Badge color={ATT_COLOR.present}>حاضر {c.present || 0}</Badge><Badge color={ATT_COLOR.late}>متأخر {c.late || 0}</Badge><Badge color={ATT_COLOR.absent}>غائب {c.absent || 0}</Badge><Badge color={ATT_COLOR.leave}>إجازة {c.leave || 0}</Badge>
        {d.late_minutes ? <Badge color="#f97316">مجموع التأخير {d.late_minutes} د</Badge> : null}
      </div>
    </View>
  );
};

export const MyCorrespondenceCard: React.FC = () => {
  const [items, setItems] = useState<any[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => { try { setItems((await hrAPI.myCorr()).data.items || []); } catch { setItems([]); } }, []);
  useEffect(() => { load(); }, [load]);
  if (!items.length) return null;
  const ack = async (id: string) => { try { await hrAPI.ackCorr(id); load(); } catch (e) { alertErr(e); } };
  return (
    <View style={reportPage.card} testID="hr-me-correspondence">
      <Text style={{ fontSize: 14, fontWeight: '800', color: '#0f2440', textAlign: 'right', marginBottom: 8 }}>تعاميم ومذكرات موجهة إليك ({items.length})</Text>
      {items.map((c) => (
        <div key={c.id} style={{ direction: 'rtl', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }} data-testid={`my-corr-${c.id}`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, cursor: 'pointer' }} onClick={() => setOpen(open === c.id ? null : c.id)}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><Badge color={CORR_COLOR[c.direction]}>{c.direction_label}</Badge><span style={{ fontWeight: 700, color: '#0f2440', fontSize: 13 }}>{c.subject}</span><span style={{ fontSize: 11, color: '#94a3b8', direction: 'ltr' }}>{c.ref_no} · {c.date}</span>{c.priority === 'urgent' && <Badge color="#dc2626">عاجلة</Badge>}</div>
            {c.acknowledged ? <span style={{ fontSize: 11.5, color: '#16a34a', fontWeight: 700 }}>✓ تم الاستلام</span> : <button onClick={(e) => { e.stopPropagation(); ack(c.id); }} style={btn('#e3f2fd', '#1565c0', { padding: '5px 10px', fontSize: 11.5 })} data-testid={`my-corr-ack-${c.id}`}>تأكيد الاستلام</button>}
          </div>
          {open === c.id && <div style={{ marginTop: 8, backgroundColor: '#f7f9fc', borderRadius: 8, padding: 10, fontSize: 12.5, lineHeight: 1.8, whiteSpace: 'pre-wrap', color: '#334155' }} data-testid={`my-corr-body-${c.id}`}>{c.body || '—'}{c.from_party ? <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 6 }}>من: {c.from_party}</div> : null}{c.attachment_url ? <a href={c.attachment_url} target="_blank" rel="noreferrer" style={{ color: '#1565c0', fontWeight: 700, fontSize: 12 }}>📎 المرفق</a> : null}</div>}
        </div>
      ))}
    </View>
  );
};

export const MyLeavesShortcut: React.FC = () => {
  const router = useRouter();
  return (
    <div style={{ display: 'flex', gap: 8, direction: 'rtl', marginBottom: 12 }}>
      <button onClick={() => router.push('/hr-my-leaves')} style={btn('#1565c0')} data-testid="hr-me-goto-leaves">🏖️ إجازاتي وطلب إجازة</button>
      <button onClick={() => router.push('/hr-tasks')} style={btn('#0f2440')} data-testid="hr-me-goto-tasks">✅ مهامي</button>
      <button onClick={() => router.push('/hr-appraisals')} style={btn('#f1f5f9', '#0f2440')} data-testid="hr-me-goto-appraisals">⭐ تقييمي السنوي</button>
      <button onClick={() => router.push('/hr-letters')} style={btn('#f1f5f9', '#0f2440')} data-testid="hr-me-goto-letters">📜 خطاباتي الرسمية</button>
    </div>
  );
};

export const MyDocumentsCard: React.FC = () => {
  const [items, setItems] = useState<any[]>([]);
  useEffect(() => { hrAPI.myDocs().then((r) => setItems(r.data.items || [])).catch(() => setItems([])); }, []);
  if (!items.length) return null;
  return (
    <View style={reportPage.card} testID="hr-me-documents">
      <Text style={{ fontSize: 14, fontWeight: '800', color: '#0f2440', textAlign: 'right', marginBottom: 4 }}>مستنداتي ({items.length})</Text>
      <Text style={{ fontSize: 11.5, color: '#64748b', textAlign: 'right', marginBottom: 6 }}>المستندات المحفوظة في ملفك لدى شؤون الموظفين — ستصلك تذكيرات قبل انتهاء أي منها</Text>
      {items.map((d) => <DocRow key={d.id} d={d} />)}
    </View>
  );
};
