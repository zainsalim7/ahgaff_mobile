import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { goBack } from '../src/utils/navigation';
import { hrAPI } from '../src/services/api';
import { useAuth } from '../src/contexts/AuthContext';
import { ReportHero, ReportKpis, ReportEmpty, reportPage } from '../src/components/reports/ReportShell';
import { Tabs, Badge, Th, td, table, btn, alertErr } from '../src/components/hr/ui';
import { LetterDetailModal, LetterFormModal, LETTER_STATUS_COLOR, downloadLetter } from '../src/components/hr/LetterModals';
import { LetterSettingsModal } from '../src/components/hr/LetterSettingsModal';

/** 📜 الخطابات الرسمية: HR يدير الطلبات ويصدر مباشرة؛ الموظف يطلب ويتابع ويحمّل */
export default function HrLetters() {
  const { hasPermission, user } = useAuth();
  const isHr = user?.role === 'admin' || hasPermission('hr_view_employees') || hasPermission('hr_manage_employees');
  const canManage = user?.role === 'admin' || hasPermission('hr_manage_employees');
  const [meta, setMeta] = useState<any>(null);
  const [tab, setTab] = useState(isHr ? 'pending' : 'mine');
  const [data, setData] = useState<any>({ items: [], counts: {} });
  const [loading, setLoading] = useState(true);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [form, setForm] = useState<'' | 'request' | 'direct'>('');
  const [settings, setSettings] = useState(false);
  const [noProfile, setNoProfile] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'mine') { const r = await hrAPI.myLetters(); setNoProfile(!r.data.profile); setData((p: any) => ({ ...p, items: r.data.items })); }
      else { const r = await hrAPI.letters(tab === 'all' ? {} : { status: tab }); setData(r.data); }
    } catch (e) { alertErr(e); } finally { setLoading(false); }
  }, [tab]);
  useEffect(() => { hrAPI.lettersMeta().then((r) => setMeta(r.data)).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  const done = (msg: string) => { window.alert(msg); setDetailId(null); setForm(''); load(); };

  const c = data.counts || {};
  const tabs = [...(isHr ? [{ key: 'pending', label: 'بانتظار الاعتماد', count: c.pending }, { key: 'approved', label: 'الصادرة', count: c.approved }, { key: 'rejected', label: 'المرفوضة', count: c.rejected }, { key: 'all', label: 'الكل' }] : []), { key: 'mine', label: 'خطاباتي' }];

  return (
    <SafeAreaView style={reportPage.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={reportPage.content}>
        <ReportHero kicker="شؤون الموظفين" title="الخطابات الرسمية" subtitle="خطاب تعريف · شهادة خبرة · إفادة استمرارية · خطاب موجّه لجهة — تُصدر PDF على الكليشة الرسمية برقم مرجعي وQR للتحقق" onBack={() => goBack()} canExport={false} testID="hr-letters-hero" />
        {isHr && <ReportKpis items={[
          { label: 'بانتظار الاعتماد', value: c.pending || 0, color: '#f97316', icon: 'hourglass' },
          { label: 'صادرة', value: c.approved || 0, color: '#16a34a', icon: 'document-text' },
          { label: 'مرفوضة', value: c.rejected || 0, color: '#dc2626', icon: 'close-circle' },
          { label: 'ملغاة', value: c.cancelled || 0, color: '#64748b', icon: 'remove-circle' },
        ]} />}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', direction: 'rtl', flexWrap: 'wrap', gap: 8 }}>
          <Tabs tabs={tabs} value={tab} onChange={setTab} testID="hr-letters-tabs" />
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {canManage && <button onClick={() => setSettings(true)} style={btn('#f1f5f9', '#0f2440')} data-testid="letters-settings-btn">⚙️ الكليشة والتوقيع</button>}
            {canManage && <button onClick={() => setForm('direct')} style={btn('#0f2440')} data-testid="letters-direct-btn">+ إصدار خطاب مباشر</button>}
            <button onClick={() => setForm('request')} style={btn('#1565c0')} data-testid="letters-request-btn">+ طلب خطاب</button>
          </div>
        </div>
        {loading ? <Text style={{ textAlign: 'center', color: '#94a3b8', padding: 20 }}>جاري التحميل...</Text>
          : data.items.length === 0 ? <ReportEmpty text={tab === 'mine' && noProfile ? 'لا يوجد ملف إداري مرتبط بحسابك' : 'لا توجد خطابات'} icon="document-text-outline" />
          : (
            <View style={[reportPage.card, { padding: 0, overflow: 'hidden' }]}>
              <table style={table} data-testid="hr-letters-table">
                <Th cols={[...(tab !== 'mine' ? ['الموظف', 'الوحدة'] : []), 'النوع', 'اللغة', 'الجهة', 'تاريخ الطلب', 'الرقم المرجعي', 'الحالة', '']} />
                <tbody>
                  {data.items.map((l: any) => (
                    <tr key={l.id} style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }} onClick={() => setDetailId(l.id)} data-testid={`letter-row-${l.id}`}>
                      {tab !== 'mine' && <td style={{ ...td, fontWeight: 700 }}>{l.employee_name} <span style={{ color: '#94a3b8', fontSize: 11 }}>({l.employee_no})</span></td>}
                      {tab !== 'mine' && <td style={td}>{l.org_unit_name || '—'}</td>}
                      <td style={td}>{l.type_label}</td>
                      <td style={td}>{l.language_label}</td>
                      <td style={td}>{l.addressed_to || 'إلى من يهمه الأمر'}</td>
                      <td style={td}>{(l.created_at || '').slice(0, 10)}</td>
                      <td style={{ ...td, fontFamily: 'monospace' }}>{l.ref_no || '—'}</td>
                      <td style={td}><Badge color={LETTER_STATUS_COLOR[l.status]}>{l.status_label}</Badge></td>
                      <td style={td} onClick={(e) => e.stopPropagation()}>{l.status === 'approved' && <button onClick={() => downloadLetter(l.id, `${l.type_label}-${l.ref_no}`)} style={btn('#e3f2fd', '#1565c0', { padding: '4px 10px', fontSize: 11.5 })} data-testid={`letter-pdf-${l.id}`}>PDF</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </View>
          )}
      </ScrollView>
      {detailId && <LetterDetailModal id={detailId} canManage={canManage && tab !== 'mine'} onClose={() => setDetailId(null)} onDone={done} />}
      {form && <LetterFormModal meta={meta} direct={form === 'direct'} onClose={() => setForm('')} onDone={done} />}
      {settings && <LetterSettingsModal onClose={() => setSettings(false)} />}
    </SafeAreaView>
  );
}
