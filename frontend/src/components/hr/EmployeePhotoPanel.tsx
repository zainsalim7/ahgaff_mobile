import React, { useCallback, useEffect, useState } from 'react';
import api, { hrAPI } from '../../services/api';
import { btn, alertErr } from './ui';

const fetchImg = async (id: string, which: 'approved' | 'pending') => {
  try { const r = await api.get(`/hr/employees/${id}/photo?which=${which}`, { responseType: 'blob' }); return URL.createObjectURL(r.data); } catch { return ''; }
};

const Photo: React.FC<{ src: string; label: string; testID: string }> = ({ src, label, testID }) => (
  <div style={{ textAlign: 'center' }} data-testid={testID}>
    <div style={{ width: 84, height: 106, borderRadius: 10, backgroundColor: '#eef2f7', overflow: 'hidden', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {src ? <img src={src} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 26 }}>👤</span>}
    </div>
    <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 3 }}>{label}</div>
  </div>
);

/** 🪪 صورة البطاقة الرقمية للموظف: المعتمدة + المعلّقة مع اعتماد/رفض/رفع/السماح بإعادة الرفع */
export const EmployeePhotoPanel: React.FC<{ employeeId: string; canManage: boolean }> = ({ employeeId, canManage }) => {
  const [card, setCard] = useState<any>(null);
  const [approved, setApproved] = useState('');
  const [pending, setPending] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const c = (await hrAPI.card(employeeId)).data;
      setCard(c);
      setApproved(c.has_photo ? await fetchImg(employeeId, 'approved') : '');
      setPending(c.pending_photo ? await fetchImg(employeeId, 'pending') : '');
    } catch { setCard(null); }
  }, [employeeId]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<any>) => { setBusy(true); try { await fn(); await load(); } catch (e) { alertErr(e); } finally { setBusy(false); } };
  const upload = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) act(() => hrAPI.uploadPhoto(employeeId, f)); e.target.value = ''; };
  if (!card) return null;

  return (
    <div style={{ marginTop: 12, backgroundColor: '#f8fafc', borderRadius: 10, padding: 10, direction: 'rtl' }} data-testid="hr-photo-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#5b6678' }}>🪪 البطاقة الرقمية · {card.kind_label}</div>
        <a href={card.verify_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#1565c0', fontWeight: 700 }} data-testid="hr-photo-verify-link">صفحة التحقق ↗</a>
      </div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <Photo src={approved} label={card.has_photo ? 'المعتمدة' : 'لا صورة معتمدة'} testID="hr-photo-approved" />
        {card.pending_photo && <Photo src={pending} label="معلّقة — بانتظار قرارك" testID="hr-photo-pending" />}
        <div style={{ flex: 1, fontSize: 11.5, color: '#475569', lineHeight: 1.7 }}>
          <div>صالحة حتى <b>{card.valid_until}</b></div>
          <div>{card.can_upload_photo ? 'يمكن للموظف رفع صورة من تطبيقه' : 'استهلك الموظف فرصة الرفع'}</div>
          {canManage && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {card.pending_photo && <button disabled={busy} onClick={() => act(() => hrAPI.photoAction(employeeId, 'approve'))} style={btn('#16a34a', '#fff', { padding: '5px 10px', fontSize: 11.5 })} data-testid="hr-photo-approve">اعتماد</button>}
              {card.pending_photo && <button disabled={busy} onClick={() => act(() => hrAPI.photoAction(employeeId, 'reject'))} style={btn('#ffebee', '#c62828', { padding: '5px 10px', fontSize: 11.5 })} data-testid="hr-photo-reject">رفض</button>}
              {!card.pending_photo && !card.can_upload_photo && <button disabled={busy} onClick={() => act(() => hrAPI.photoAction(employeeId, 'allow-upload'))} style={btn('#fff7ed', '#c2410c', { padding: '5px 10px', fontSize: 11.5 })} data-testid="hr-photo-allow">السماح برفع جديد</button>}
              <label style={{ ...btn('#e3f2fd', '#1565c0', { padding: '5px 10px', fontSize: 11.5 }), cursor: 'pointer' }} data-testid="hr-photo-upload-label">
                رفع صورة (تُعتمد مباشرة)<input type="file" accept="image/jpeg,image/png,image/webp" onChange={upload} style={{ display: 'none' }} data-testid="hr-photo-upload-input" />
              </label>
              {card.has_photo && <button disabled={busy} onClick={() => window.confirm('حذف الصورة المعتمدة؟') && act(() => hrAPI.deletePhoto(employeeId))} style={btn('#f1f5f9', '#0f2440', { padding: '5px 10px', fontSize: 11.5 })} data-testid="hr-photo-delete">حذف المعتمدة</button>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
