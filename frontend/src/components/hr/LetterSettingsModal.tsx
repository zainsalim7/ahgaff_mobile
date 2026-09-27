import React, { useEffect, useState, useCallback } from 'react';
import { hrAPI } from '../../services/api';
import { Modal, Field, inp, btn, alertErr } from './ui';

const ImgBox: React.FC<{ kind: 'letterhead' | 'signature'; has: boolean; label: string; hint: string; onChange: () => void; w: number; h: number }> = ({ kind, has, label, hint, onChange, w, h }) => {
  const [src, setSrc] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!has) { setSrc(''); return; } hrAPI.letterImage(kind).then((r) => setSrc(URL.createObjectURL(r.data))).catch(() => setSrc('')); }, [kind, has]);
  const up = async (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; setBusy(true); try { await hrAPI.uploadLetterImage(kind, f); onChange(); } catch (er) { alertErr(er); } finally { setBusy(false); } };
  const del = async () => { if (!window.confirm('حذف الصورة؟')) return; setBusy(true); try { await hrAPI.deleteLetterImage(kind); onChange(); } catch (er) { alertErr(er); } finally { setBusy(false); } };
  return (
    <div style={{ backgroundColor: '#f8fafc', borderRadius: 10, padding: 10 }} data-testid={`letter-img-${kind}`}>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: '#0f2440', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>{hint}</div>
      <div style={{ width: w, height: h, backgroundColor: '#fff', border: '1px dashed #cbd5e1', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', margin: '0 auto 8px' }}>
        {src ? <img src={src} alt={label} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} data-testid={`letter-img-${kind}-preview`} /> : <span style={{ color: '#94a3b8', fontSize: 12 }}>لا توجد صورة</span>}
      </div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
        <label style={{ ...btn('#e3f2fd', '#1565c0', { padding: '5px 10px', fontSize: 11.5 }), cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>{has ? 'استبدال' : 'رفع صورة'}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={up} style={{ display: 'none' }} data-testid={`letter-img-${kind}-input`} /></label>
        {has && <button disabled={busy} onClick={del} style={btn('#ffebee', '#c62828', { padding: '5px 10px', fontSize: 11.5 })} data-testid={`letter-img-${kind}-delete`}>حذف</button>}
      </div>
    </div>
  );
};

/** ⚙️ إعدادات الكليشة: صورة الترويسة A4 + صورة التوقيع/الختم + بيانات الموقّع والتذييل */
export const LetterSettingsModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [s, setS] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => hrAPI.letterSettings().then((r) => setS(r.data)).catch(alertErr), []);
  useEffect(() => { load(); }, [load]);
  if (!s) return null;
  const set = (k: string) => (e: any) => setS((p: any) => ({ ...p, [k]: e.target.value }));
  const save = async () => {
    setBusy(true);
    try { await hrAPI.saveLetterSettings({ ...s, top_margin_mm: Number(s.top_margin_mm) || 45, bottom_margin_mm: Number(s.bottom_margin_mm) || 35 }); window.alert('تم حفظ الإعدادات'); onClose(); } catch (e) { alertErr(e); } finally { setBusy(false); }
  };
  return (
    <Modal title="إعدادات الخطابات الرسمية — الكليشة والتوقيع" onClose={onClose} width={760} testID="letter-settings-modal" busy={busy}>
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 12, marginBottom: 14 }}>
        <ImgBox kind="letterhead" has={!!s.has_letterhead} label="الكليشة (ورق الخطابات الرسمي)" hint="صورة صفحة A4 كاملة (نسبة 1:1.414 — مثل 2480×3508) تحوي الشعار والترويسة والتذييل. تُطبع خلف نص الخطاب." onChange={load} w={170} h={240} />
        <ImgBox kind="signature" has={!!s.has_signature} label="التوقيع / الختم" hint="صورة PNG بخلفية شفافة يُفضَّل، تُوضع فوق اسم الموقّع." onChange={load} w={200} h={100} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="اسم الموقّع (عربي)"><input value={s.signer_name || ''} onChange={set('signer_name')} style={inp} data-testid="letter-signer-name" /></Field>
        <Field label="المنصب (عربي)"><input value={s.signer_title || ''} onChange={set('signer_title')} style={inp} data-testid="letter-signer-title" /></Field>
        <Field label="Signer name (English)"><input value={s.signer_name_en || ''} onChange={set('signer_name_en')} style={{ ...inp, direction: 'ltr' }} data-testid="letter-signer-name-en" /></Field>
        <Field label="Title (English)"><input value={s.signer_title_en || ''} onChange={set('signer_title_en')} style={{ ...inp, direction: 'ltr' }} data-testid="letter-signer-title-en" /></Field>
        <Field label="تذييل الخطاب العربي (اختياري إن كانت الكليشة تحويه)"><input value={s.footer_ar || ''} onChange={set('footer_ar')} style={inp} data-testid="letter-footer-ar" /></Field>
        <Field label="English footer (optional)"><input value={s.footer_en || ''} onChange={set('footer_en')} style={{ ...inp, direction: 'ltr' }} data-testid="letter-footer-en" /></Field>
        <Field label="الهامش العلوي (مم) — مساحة الترويسة في الكليشة"><input type="number" value={s.top_margin_mm} onChange={set('top_margin_mm')} style={inp} data-testid="letter-top-margin" /></Field>
        <Field label="الهامش السفلي (مم) — مساحة التذييل"><input type="number" value={s.bottom_margin_mm} onChange={set('bottom_margin_mm')} style={inp} data-testid="letter-bottom-margin" /></Field>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button disabled={busy} onClick={save} style={btn('#1565c0')} data-testid="letter-settings-save">حفظ</button>
        <button onClick={onClose} style={btn('#f1f5f9', '#0f2440')}>إغلاق</button>
      </div>
    </Modal>
  );
};
