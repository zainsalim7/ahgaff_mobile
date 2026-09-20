import React, { useCallback, useEffect, useState } from 'react';
import { exportName, filenameFromResponse } from '../src/utils/exportName';
import { BulkPaymentModal } from '../src/components/BulkPaymentModal';
import { ZoomableImageModal } from '../src/components/ZoomableImageModal';
import { View, Text, TouchableOpacity, Image, Modal, TextInput, Platform, Alert, ScrollView } from 'react-native';
import { Stack, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api from '../src/services/api';

const notify = (msg: string) => { if (Platform.OS === 'web') window.alert(msg); else Alert.alert('', msg); };
const selStyle: any = { padding: 7, borderRadius: 8, border: '1px solid #ddd', fontSize: 12, fontFamily: 'inherit', background: '#fff', minWidth: 150 };

export default function FeeReceiptsScreen() {
  const [tab, setTab] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [receipts, setReceipts] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [types, setTypes] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [image, setImage] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [showTypes, setShowTypes] = useState(false);
  const [newType, setNewType] = useState('');
  const [loading, setLoading] = useState(false);
  // ✍️ تسجيل دفع يدوي
  const [showManual, setShowManual] = useState(false);
  const [showBulkPay, setShowBulkPay] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [mSearch, setMSearch] = useState('');
  const [mResults, setMResults] = useState<any[]>([]);
  const [mStudent, setMStudent] = useState<any>(null);
  const [mType, setMType] = useState<any>(null);
  const [mOther, setMOther] = useState('');
  const [mReceiptNo, setMReceiptNo] = useState('');
  const [mAmount, setMAmount] = useState('');
  const [mStatement, setMStatement] = useState('');
  const [mDate, setMDate] = useState('');
  const [newTypeRecurring, setNewTypeRecurring] = useState(false);
  // 🔎 بحث وفرز
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [fType, setFType] = useState('');
  const [fDept, setFDept] = useState('');
  const [fLevel, setFLevel] = useState('');
  const [sort, setSort] = useState<'newest' | 'oldest' | 'name'>('newest');
  // ☑️ اعتماد جماعي
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkReason, setBulkReason] = useState('');
  const [showBulkReject, setShowBulkReject] = useState(false);
  const isAdmin = !!stats?.is_admin;

  useEffect(() => { const t = setTimeout(() => setDebounced(search.trim()), 350); return () => clearTimeout(t); }, [search]);

  const loadMeta = useCallback(async () => {
    try {
      const [s, t] = await Promise.all([api.get('/fees/stats'), api.get('/fees/types')]);
      setStats(s.data);
      setTypes((t.data.types || []).filter((x: any) => x.id !== 'other'));
    } catch { notify('فشل التحميل — تأكد من صلاحيتك'); }
  }, []);
  const loadReceipts = useCallback(async () => {
    try {
      const params: any = { status: tab, sort };
      if (debounced) params.search = debounced;
      if (fType) params.type_id = fType;
      if (fDept) params.department_id = fDept;
      if (fLevel) params.level = parseInt(fLevel, 10);
      const r = await api.get('/fees/receipts', { params });
      setReceipts(r.data.receipts || []);
    } catch { notify('فشل تحميل السندات'); }
  }, [tab, sort, debounced, fType, fDept, fLevel]);
  const load = useCallback(async () => { await Promise.all([loadMeta(), loadReceipts()]); }, [loadMeta, loadReceipts]);
  useEffect(() => { loadMeta(); }, [loadMeta]);
  useEffect(() => { loadReceipts(); }, [loadReceipts]);
  useEffect(() => { setSelectedIds(new Set()); setSelectMode(false); }, [tab]);

  const toggleSelect = (id: string) => setSelectedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const isSuspicious = (r: any) => !!(r.duplicate_receipt_no || r.date_warning);
  const selectAllVisible = () => {
    const safe = receipts.filter((r) => !isSuspicious(r)).map((r) => r.id);
    const skipped = receipts.length - safe.length;
    setSelectedIds(new Set(safe));
    if (skipped > 0) notify(`تم تحديد ${safe.length} سند — استُثني ${skipped} سند يحمل تحذيراً (رقم مكرر/تاريخ خارج العام) ويحتاج مراجعة فردية`);
  };
  const bulkReview = async (action: 'approve' | 'reject') => {
    if (selectedIds.size === 0) { notify('لم يتم تحديد أي سند'); return; }
    if (action === 'reject' && !bulkReason.trim()) { notify('اكتب سبب الرفض المشترك'); return; }
    if (action === 'approve' && Platform.OS === 'web' && !window.confirm(`اعتماد ${selectedIds.size} سند دفعة واحدة؟`)) return;
    setLoading(true);
    try {
      const r = await api.post('/fees/receipts/bulk-review', { receipt_ids: Array.from(selectedIds), action, reason: bulkReason.trim() });
      const sk = (r.data.skipped || []) as any[];
      notify(r.data.message + (sk.length ? `\n${sk.map((x) => `• ${x.reason}`).join('\n')}` : ''));
      setSelectedIds(new Set()); setSelectMode(false); setShowBulkReject(false); setBulkReason('');
      load();
    } catch (e: any) { notify(e?.response?.data?.detail || 'فشلت العملية'); }
    finally { setLoading(false); }
  };

  const openReceipt = async (item: any) => {
    setSelected(item); setImage(''); setRejectReason('');
    try { const r = await api.get(`/fees/receipts/${item.id}/image`); setImage(r.data.image_base64 || ''); } catch { /* noop */ }
  };
  const review = async (action: 'approve' | 'reject') => {
    if (action === 'reject' && !rejectReason.trim()) { notify('اكتب سبب الرفض'); return; }
    setLoading(true);
    try {
      const r = await api.post(`/fees/receipts/${selected.id}/${action}`, action === 'reject' ? { reason: rejectReason.trim() } : {});
      notify(r.data.message); setSelected(null); load();
    } catch (e: any) { notify(e?.response?.data?.detail || 'فشلت العملية'); }
    finally { setLoading(false); }
  };
  const remind = async (typeId: string, name: string) => {
    if (Platform.OS === 'web' && !window.confirm(`إرسال تذكير لكل غير الدافعين لـ«${name}»؟`)) return;
    try { const r = await api.post('/fees/remind-unpaid', { type_id: typeId }); notify(r.data.message); } catch { notify('فشل الإرسال'); }
  };
  const exportUnpaid = async (typeId: string, name: string) => {
    try {
      const r = await api.get('/fees/unpaid-export', { params: { type_id: typeId }, responseType: 'blob' });
      if (Platform.OS === 'web') {
        const url = window.URL.createObjectURL(new Blob([r.data]));
        const a = document.createElement('a');
        a.href = url; a.download = filenameFromResponse(r, exportName(['كشف غير الدافعين', name], 'xlsx')); a.click();
        window.URL.revokeObjectURL(url);
      }
    } catch { notify('فشل التصدير'); }
  };
  const searchStudents = async (txt: string) => {
    setMSearch(txt); setMStudent(null);
    if (txt.trim().length < 2) { setMResults([]); return; }
    try {
      const r = await api.get('/students', { params: { search: txt.trim() } });
      const list = Array.isArray(r.data) ? r.data : (r.data.students || []);
      const q = txt.trim();
      setMResults(list.filter((s: any) => (s.full_name || '').includes(q) || (s.student_id || '').includes(q)).slice(0, 8));
    } catch { setMResults([]); }
  };
  const submitManual = async () => {
    if (!mStudent) { notify('اختر الطالب'); return; }
    if (!mType) { notify('اختر نوع الرسوم'); return; }
    setLoading(true);
    try {
      const r = await api.post('/fees/manual-payment', {
        student_id: mStudent.id, type_id: mType.id === 'other' ? 'other' : mType.id,
        other_label: mOther, receipt_no: mReceiptNo, amount: mAmount, statement: mStatement, receipt_date: mDate, notes: 'تسجيل يدوي من الإدارة',
      });
      notify(r.data.message);
      setShowManual(false); setMStudent(null); setMSearch(''); setMType(null); setMOther(''); setMReceiptNo(''); setMAmount(''); setMStatement(''); setMDate('');
      load();
    } catch (e: any) { notify(e?.response?.data?.detail || 'فشلت العملية'); }
    finally { setLoading(false); }
  };
  const unapprove = async () => {
    if (Platform.OS === 'web' && !window.confirm('إعادة هذا السند المعتمد إلى «قيد المراجعة»؟')) return;
    setLoading(true);
    try {
      const r = await api.post(`/fees/receipts/${selected.id}/unapprove`);
      notify(r.data.message); setSelected(null); load();
    } catch (e: any) { notify(e?.response?.data?.detail || 'فشلت العملية'); }
    finally { setLoading(false); }
  };
  const addType = async () => {
    if (!newType.trim()) return;
    try { await api.post('/fees/types', { name: newType.trim(), recurring: newTypeRecurring }); setNewType(''); setNewTypeRecurring(false); load(); }
    catch (e: any) { notify(e?.response?.data?.detail || 'فشل'); }
  };
  const toggleRecurring = async (t: any) => {
    try { await api.put(`/fees/types/${t.id}`, { recurring: !t.recurring }); load(); }
    catch (e: any) { notify(e?.response?.data?.detail || 'فشل'); }
  };

  const TABS = [['pending', 'بانتظار التعميد'], ['approved', 'المقبولة'], ['rejected', 'المرفوضة']] as const;
  return (
    <>
      <Stack.Screen options={{ title: 'السندات المالية' }} />
      <SafeAreaView style={{ flex: 1, backgroundColor: '#f5f7fa' }} edges={['bottom']}>
        <ScrollView contentContainerStyle={{ padding: 16, maxWidth: 1100, width: '100%', alignSelf: 'center' }}>
          {stats && (
            <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              {stats.stats?.map((s: any) => (
                <View key={s.type_id} style={{ backgroundColor: '#fff', borderRadius: 10, padding: 10, minWidth: 220 }} testID={`fee-stat-${s.type_id}`}>
                  <Text style={{ fontWeight: '800', textAlign: 'right', fontSize: 13 }}>{s.type_name}{s.recurring ? '  🔁 شهري' : ''}</Text>
                  <Text style={{ textAlign: 'right', fontSize: 11, color: '#555', marginTop: 3 }}>
                    {s.recurring
                      ? `🟢 دفعات معتمدة: ${s.approved} (لـ${s.paid_students} طالباً)   🟡 معلقة: ${s.pending}   ⚪ لم يدفع: ${s.not_paid}`
                      : `🟢 دافع: ${s.approved}   🟡 قيد المراجعة: ${s.pending}   ⚪ غير دافع: ${s.not_paid}`}
                  </Text>
                  <TouchableOpacity onPress={() => remind(s.type_id, s.type_name)} testID={`fee-remind-${s.type_id}`}
                    style={{ backgroundColor: '#fff3e0', borderRadius: 6, padding: 5, marginTop: 6 }}>
                    <Text style={{ color: '#e65100', fontSize: 11, fontWeight: '800', textAlign: 'center' }}>🔔 تذكير غير الدافعين</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => exportUnpaid(s.type_id, s.type_name)} testID={`fee-export-${s.type_id}`}
                    style={{ backgroundColor: '#e8f5e9', borderRadius: 6, padding: 5, marginTop: 5 }}>
                    <Text style={{ color: '#2e7d32', fontSize: 11, fontWeight: '800', textAlign: 'center' }}>📄 Excel غير الدافعين</Text>
                  </TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity onPress={() => router.push('/payments-report' as any)} testID="fee-report-btn"
                style={{ backgroundColor: '#e3f2fd', borderRadius: 10, padding: 10, justifyContent: 'center' }}>
                <Text style={{ color: '#1565c0', fontWeight: '800', fontSize: 12 }}>📊 تقرير سدادات</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowManual(true)} testID="fee-manual-btn"
                style={{ backgroundColor: '#e8f5e9', borderRadius: 10, padding: 10, justifyContent: 'center' }}>
                <Text style={{ color: '#2e7d32', fontWeight: '800', fontSize: 12 }}>✍️ تسجيل دفع يدوي</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowBulkPay(true)} testID="fee-bulk-pay-btn"
                style={{ backgroundColor: '#1b5e20', borderRadius: 10, padding: 10, justifyContent: 'center' }}>
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>💰 تسجيل دفع جماعي</Text>
              </TouchableOpacity>
              {isAdmin && (
                <TouchableOpacity onPress={() => setShowTypes(true)} testID="fee-types-btn"
                  style={{ backgroundColor: '#e8eaf6', borderRadius: 10, padding: 10, justifyContent: 'center' }}>
                  <Text style={{ color: '#3949ab', fontWeight: '800', fontSize: 12 }}>⚙️ أنواع الرسوم</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          <View style={{ flexDirection: 'row-reverse', gap: 8, marginBottom: 12 }}>
            {TABS.map(([k, label]) => (
              <TouchableOpacity key={k} onPress={() => setTab(k)} testID={`fee-tab-${k}`}
                style={{ backgroundColor: tab === k ? '#1565c0' : '#fff', borderRadius: 20, paddingVertical: 8, paddingHorizontal: 16 }}>
                <Text style={{ color: tab === k ? '#fff' : '#1565c0', fontWeight: '800', fontSize: 12 }}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={{ backgroundColor: '#fff', borderRadius: 10, padding: 10, marginBottom: 12, gap: 8 }} testID="fee-filter-bar">
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 8 }}>
              <Ionicons name="search" size={16} color="#999" />
              <TextInput value={search} onChangeText={setSearch} placeholder="بحث: اسم الطالب / رقم القيد / رقم السند"
                style={{ flex: 1, padding: 8, textAlign: 'right', fontSize: 12 }} testID="fee-search-input" />
              {!!search && <TouchableOpacity onPress={() => setSearch('')} testID="fee-search-clear"><Ionicons name="close-circle" size={16} color="#999" /></TouchableOpacity>}
            </View>
            {Platform.OS === 'web' && (
              <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <select value={fType} onChange={(e: any) => setFType(e.target.value)} data-testid="fee-filter-type" style={selStyle}>
                  <option value="">كل أنواع الرسوم</option>
                  {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <select value={fDept} onChange={(e: any) => setFDept(e.target.value)} data-testid="fee-filter-dept" style={selStyle}>
                  <option value="">{isAdmin ? 'كل الأقسام' : 'كل أقسام نطاقي'}</option>
                  {(stats?.departments || []).map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <select value={fLevel} onChange={(e: any) => setFLevel(e.target.value)} data-testid="fee-filter-level" style={selStyle}>
                  <option value="">كل المستويات</option>
                  {[1, 2, 3, 4, 5, 6].map((l) => <option key={l} value={String(l)}>المستوى {l}</option>)}
                </select>
                <select value={sort} onChange={(e: any) => setSort(e.target.value)} data-testid="fee-sort" style={selStyle}>
                  <option value="newest">الأحدث أولاً</option>
                  <option value="oldest">الأقدم أولاً</option>
                  <option value="name">حسب اسم الطالب</option>
                </select>
                {(fType || fDept || fLevel || search) && (
                  <TouchableOpacity onPress={() => { setFType(''); setFDept(''); setFLevel(''); setSearch(''); }} testID="fee-filter-reset">
                    <Text style={{ color: '#c62828', fontSize: 11, fontWeight: '800' }}>✖ مسح الفلاتر</Text>
                  </TouchableOpacity>
                )}
                <Text style={{ fontSize: 11, color: '#666', marginRight: 'auto' }} testID="fee-count">{receipts.length} سند</Text>
              </View>
            )}
            {tab === 'pending' && receipts.length > 0 && (
              <View style={{ flexDirection: 'row-reverse', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <TouchableOpacity onPress={() => { setSelectMode(!selectMode); setSelectedIds(new Set()); }} testID="fee-select-mode-btn"
                  style={{ backgroundColor: selectMode ? '#1565c0' : '#e3f2fd', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12 }}>
                  <Text style={{ color: selectMode ? '#fff' : '#1565c0', fontWeight: '800', fontSize: 12 }}>{selectMode ? 'إلغاء التحديد' : '☑️ تحديد للاعتماد الجماعي'}</Text>
                </TouchableOpacity>
                {selectMode && (
                  <TouchableOpacity onPress={selectAllVisible} testID="fee-select-all-btn" style={{ backgroundColor: '#f0f0f0', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12 }}>
                    <Text style={{ fontWeight: '800', fontSize: 12, color: '#333' }}>تحديد الكل (المعروض)</Text>
                  </TouchableOpacity>
                )}
                {selectMode && <Text style={{ fontSize: 12, color: '#1565c0', fontWeight: '800' }} testID="fee-selected-count">المحدد: {selectedIds.size}</Text>}
              </View>
            )}
          </View>
          {receipts.length === 0 && <Text style={{ textAlign: 'center', color: '#999', marginTop: 30 }} testID="fee-empty">لا توجد سندات</Text>}
          {receipts.map((item) => (
            <TouchableOpacity key={item.id} onPress={() => (selectMode ? toggleSelect(item.id) : openReceipt(item))} testID={`fee-receipt-${item.id}`}
              style={{ backgroundColor: selectedIds.has(item.id) ? '#e3f2fd' : '#fff', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: selectedIds.has(item.id) ? 1 : 0, borderColor: '#1565c0' }}>
              <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
                  {selectMode && (
                    <TouchableOpacity onPress={() => toggleSelect(item.id)} testID={`fee-check-${item.id}`}>
                      <Ionicons name={selectedIds.has(item.id) ? 'checkbox' : 'square-outline'} size={20} color="#1565c0" />
                    </TouchableOpacity>
                  )}
                  <Text style={{ fontWeight: '800', fontSize: 13 }}>{item.student_name}</Text>
                </View>
                <Text style={{ fontSize: 11, color: '#1565c0', fontWeight: '800' }}>{item.type_name}</Text>
              </View>
              <Text style={{ textAlign: 'right', fontSize: 11, color: '#666', marginTop: 3 }}>
                {item.student_number} | {item.department_name} م{item.level}
                {item.statement ? ` | 📝 ${item.statement}` : ''}
                {item.receipt_date ? ` | 📅 ${item.receipt_date}` : ''}
                {item.receipt_no ? ` | سند رقم ${item.receipt_no}` : ''}{item.amount ? ` | ${item.amount}` : ''}
              </Text>
              {item.date_warning && (
                <Text style={{ textAlign: 'right', fontSize: 10, color: '#f57f17', fontWeight: '800', marginTop: 2, backgroundColor: '#fff8e1', borderRadius: 4, paddingHorizontal: 4, alignSelf: 'flex-end' }} testID={`fee-datewarn-${item.id}`}>⚠️ تاريخ السند خارج العام الجامعي الحالي</Text>
              )}
              {item.duplicate_receipt_no && (
                <Text style={{ textAlign: 'right', fontSize: 10, color: '#c62828', fontWeight: '800', marginTop: 2 }} testID={`fee-dup-${item.id}`}>⚠️ رقم السند مكرر مع سند آخر!</Text>
              )}
              {item.manual_entry && (
                <Text style={{ textAlign: 'right', fontSize: 10, color: '#2e7d32', fontWeight: '800', marginTop: 2 }} testID={`fee-manual-${item.id}`}>✍️ تسجيل يدوي من الإدارة ({item.reviewed_by})</Text>
              )}
              {item.status === 'rejected' && !!item.rejection_reason && (
                <Text style={{ textAlign: 'right', fontSize: 10, color: '#c62828', marginTop: 2 }}>سبب الرفض: {item.rejection_reason}</Text>
              )}
            </TouchableOpacity>
          ))}
        </ScrollView>
        {selectMode && selectedIds.size > 0 && (
          <View style={{ flexDirection: 'row-reverse', gap: 8, padding: 12, backgroundColor: '#fff', borderTopWidth: 1, borderColor: '#e0e0e0', alignItems: 'center' }} testID="fee-bulk-bar">
            <TouchableOpacity disabled={loading} onPress={() => bulkReview('approve')} testID="fee-bulk-approve-btn"
              style={{ flex: 1, backgroundColor: '#2e7d32', borderRadius: 8, padding: 12 }}>
              <Text style={{ color: '#fff', fontWeight: '800', textAlign: 'center' }}>✅ اعتماد المحدد ({selectedIds.size})</Text>
            </TouchableOpacity>
            <TouchableOpacity disabled={loading} onPress={() => setShowBulkReject(true)} testID="fee-bulk-reject-btn"
              style={{ flex: 1, backgroundColor: '#c62828', borderRadius: 8, padding: 12 }}>
              <Text style={{ color: '#fff', fontWeight: '800', textAlign: 'center' }}>❌ رفض المحدد</Text>
            </TouchableOpacity>
          </View>
        )}

        <BulkPaymentModal visible={showBulkPay} onClose={() => setShowBulkPay(false)} onDone={load} departments={stats?.departments || []} />

        <Modal visible={showBulkReject} transparent animationType="fade" onRequestClose={() => setShowBulkReject(false)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 16 }}>
            <View style={{ backgroundColor: '#fff', borderRadius: 14, padding: 16, width: '100%', maxWidth: 420 }} testID="fee-bulk-reject-modal">
              <Text style={{ fontWeight: '800', textAlign: 'right', marginBottom: 8 }}>رفض {selectedIds.size} سند — سبب مشترك</Text>
              <TextInput value={bulkReason} onChangeText={setBulkReason} placeholder="سبب الرفض (سيُرسل لكل الطلاب المحددين)"
                style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 8, textAlign: 'right', fontSize: 12 }} testID="fee-bulk-reason" />
              <View style={{ flexDirection: 'row-reverse', gap: 8, marginTop: 10 }}>
                <TouchableOpacity disabled={loading} onPress={() => bulkReview('reject')} testID="fee-bulk-reject-confirm"
                  style={{ flex: 1, backgroundColor: '#c62828', borderRadius: 8, padding: 10 }}>
                  <Text style={{ color: '#fff', fontWeight: '800', textAlign: 'center' }}>تأكيد الرفض</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowBulkReject(false)} style={{ flex: 1, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#ddd' }}>
                  <Text style={{ textAlign: 'center', color: '#333', fontWeight: '800' }}>إلغاء</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 16 }}>
            <View style={{ backgroundColor: '#fff', borderRadius: 14, padding: 16, width: '100%', maxWidth: 560, maxHeight: '92%' }} testID="fee-review-modal">
              <ScrollView>
                <Text style={{ fontWeight: '800', fontSize: 15, textAlign: 'right' }}>{selected?.student_name} — {selected?.type_name}</Text>
                {selected?.statement ? <Text style={{ fontSize: 12, color: '#1565c0', fontWeight: '800', textAlign: 'right', marginTop: 2 }}>📝 البيان: {selected.statement}</Text> : null}
                {selected?.receipt_date ? <Text style={{ fontSize: 12, color: selected?.date_warning ? '#f57f17' : '#333', fontWeight: '800', textAlign: 'right', marginTop: 2 }}>📅 تاريخ السند: {selected.receipt_date}{selected?.date_warning ? '  ⚠️ خارج العام الحالي!' : ''}</Text> : null}
                <Text style={{ fontSize: 11, color: '#666', textAlign: 'right', marginTop: 3 }}>
                  {selected?.student_number} | {selected?.department_name} | رفع: {selected?.uploaded_at?.slice(0, 16).replace('T', ' ')}
                </Text>
                {image ? (
                  <View style={{ marginTop: 10 }}>
                    <TouchableOpacity onPress={() => setZoomOpen(true)} activeOpacity={0.85} testID="fee-receipt-image-btn">
                      <Image source={{ uri: image.startsWith('data:') ? image : `data:image/jpeg;base64,${image}` }}
                        style={{ width: '100%', height: 420, borderRadius: 8 }} resizeMode="contain" testID="fee-receipt-image" />
                      <View style={{ position: 'absolute', bottom: 8, left: 8, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 16, paddingVertical: 4, paddingHorizontal: 10, flexDirection: 'row-reverse', alignItems: 'center', gap: 4 }}>
                        <Ionicons name="search" size={13} color="#fff" />
                        <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>اضغط للتكبير</Text>
                      </View>
                    </TouchableOpacity>
                    <ZoomableImageModal visible={zoomOpen} onClose={() => setZoomOpen(false)}
                      uri={image.startsWith('data:') ? image : `data:image/jpeg;base64,${image}`}
                      title={`${selected?.student_name || ''} — ${selected?.type_name || ''}${selected?.receipt_no ? ` — سند ${selected.receipt_no}` : ''}`} />
                  </View>
                ) : <Text style={{ textAlign: 'center', color: '#999', marginVertical: 30 }}>جارٍ تحميل الصورة...</Text>}
                {selected?.notes ? <Text style={{ textAlign: 'right', fontSize: 12, marginTop: 6 }}>ملاحظة الطالب: {selected.notes}</Text> : null}
                {selected?.status === 'pending' && (
                  <>
                    <TextInput value={rejectReason} onChangeText={setRejectReason} placeholder="سبب الرفض (إلزامي عند الرفض)"
                      style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 8, marginTop: 10, textAlign: 'right', fontSize: 12 }} testID="fee-reject-reason" />
                    <View style={{ flexDirection: 'row-reverse', gap: 8, marginTop: 10 }}>
                      <TouchableOpacity disabled={loading} onPress={() => review('approve')} testID="fee-approve-btn"
                        style={{ flex: 1, backgroundColor: '#2e7d32', borderRadius: 8, padding: 12 }}>
                        <Text style={{ color: '#fff', fontWeight: '800', textAlign: 'center' }}>✅ تعميد وقبول</Text>
                      </TouchableOpacity>
                      <TouchableOpacity disabled={loading} onPress={() => review('reject')} testID="fee-reject-btn"
                        style={{ flex: 1, backgroundColor: '#c62828', borderRadius: 8, padding: 12 }}>
                        <Text style={{ color: '#fff', fontWeight: '800', textAlign: 'center' }}>❌ رفض</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )}
                {selected?.status === 'approved' && (
                  <TouchableOpacity disabled={loading} onPress={unapprove} testID="fee-unapprove-btn"
                    style={{ backgroundColor: '#fff3e0', borderRadius: 8, padding: 12, marginTop: 10, borderWidth: 1, borderColor: '#f57f17' }}>
                    <Text style={{ color: '#e65100', fontWeight: '800', textAlign: 'center' }}>↩️ إلغاء الاعتماد (إعادته لقيد المراجعة)</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => setSelected(null)} style={{ marginTop: 10, padding: 8 }} testID="fee-close-modal">
                  <Text style={{ textAlign: 'center', color: '#1565c0', fontWeight: '800' }}>إغلاق</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </Modal>

        <Modal visible={showManual} transparent animationType="fade" onRequestClose={() => setShowManual(false)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 16 }}>
            <View style={{ backgroundColor: '#fff', borderRadius: 14, padding: 16, width: '100%', maxWidth: 460, maxHeight: '92%' }} testID="fee-manual-modal">
              <ScrollView>
                <Text style={{ fontWeight: '800', textAlign: 'right', marginBottom: 8 }}>✍️ تسجيل دفع يدوي (اعتماد فوري)</Text>
                <TextInput value={mSearch} onChangeText={searchStudents} placeholder="ابحث بالاسم أو رقم القيد..."
                  style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 8, textAlign: 'right', fontSize: 12 }} testID="fee-manual-search" />
                {!mStudent && mResults.map((s) => (
                  <TouchableOpacity key={s.id} onPress={() => { setMStudent(s); setMResults([]); }} testID={`fee-manual-student-${s.id}`}
                    style={{ padding: 8, borderBottomWidth: 1, borderColor: '#f0f0f0' }}>
                    <Text style={{ textAlign: 'right', fontSize: 12 }}>{s.full_name} — {s.student_id} ({s.department_name || ''} م{s.level})</Text>
                  </TouchableOpacity>
                ))}
                {mStudent && (
                  <View style={{ backgroundColor: '#e8f5e9', borderRadius: 8, padding: 8, marginTop: 6 }}>
                    <Text style={{ textAlign: 'right', fontSize: 12, fontWeight: '800', color: '#2e7d32' }}>الطالب: {mStudent.full_name} — {mStudent.student_id}</Text>
                  </View>
                )}
                <Text style={{ textAlign: 'right', fontSize: 12, fontWeight: '800', marginTop: 10 }}>نوع الرسوم:</Text>
                <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {[...types, { id: 'other', name: 'أخرى (نوع حر)' }].map((t: any) => (
                    <TouchableOpacity key={t.id} onPress={() => setMType(t)} testID={`fee-manual-type-${t.id}`}
                      style={{ backgroundColor: mType?.id === t.id ? '#1565c0' : '#f0f0f0', borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12 }}>
                      <Text style={{ color: mType?.id === t.id ? '#fff' : '#333', fontSize: 11, fontWeight: '700' }}>{t.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {mType?.id === 'other' && (
                  <TextInput value={mOther} onChangeText={setMOther} placeholder="اكتب نوع الرسوم..."
                    style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 8, textAlign: 'right', fontSize: 12, marginTop: 6 }} testID="fee-manual-other" />
                )}
                <TextInput value={mStatement} onChangeText={setMStatement}
                  placeholder={mType?.recurring ? 'بيان الدفعة (إلزامي — مثال: تغذية شهر يناير)' : 'بيان الدفعة (اختياري)'}
                  style={{ borderWidth: 1, borderColor: mType?.recurring ? '#f57f17' : '#ddd', borderRadius: 8, padding: 8, textAlign: 'right', fontSize: 12, marginTop: 6 }} testID="fee-manual-statement" />
                <View style={{ flexDirection: 'row-reverse', gap: 6, marginTop: 8 }}>
                  <TextInput value={mReceiptNo} onChangeText={setMReceiptNo} placeholder="رقم السند (اختياري)"
                    style={{ flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 8, textAlign: 'right', fontSize: 12 }} testID="fee-manual-receiptno" />
                  <TextInput value={mAmount} onChangeText={setMAmount} placeholder="المبلغ (اختياري)"
                    style={{ flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 8, textAlign: 'right', fontSize: 12 }} testID="fee-manual-amount" />
                </View>
                <TextInput value={mDate} onChangeText={setMDate} placeholder="📅 تاريخ السند الورقي YYYY-MM-DD (اختياري)"
                  style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 8, textAlign: 'right', fontSize: 12, marginTop: 6 }} testID="fee-manual-date" />
                <TouchableOpacity disabled={loading} onPress={submitManual} testID="fee-manual-submit"
                  style={{ backgroundColor: '#2e7d32', borderRadius: 8, padding: 12, marginTop: 12 }}>
                  <Text style={{ color: '#fff', fontWeight: '800', textAlign: 'center' }}>✅ اعتباره دافعاً</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowManual(false)} style={{ marginTop: 8, padding: 6 }}>
                  <Text style={{ textAlign: 'center', color: '#1565c0', fontWeight: '800' }}>إلغاء</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </Modal>

        <Modal visible={showTypes} transparent animationType="fade" onRequestClose={() => setShowTypes(false)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 16 }}>
            <View style={{ backgroundColor: '#fff', borderRadius: 14, padding: 16, width: '100%', maxWidth: 420 }} testID="fee-types-modal">
              <Text style={{ fontWeight: '800', textAlign: 'right', marginBottom: 8 }}>أنواع الرسوم</Text>
              {types.map((t) => (
                <View key={t.id} style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderColor: '#f0f0f0' }}>
                  <Text style={{ fontSize: 13 }}>{t.name}{t.builtin ? '  (أساسي)' : ''}{t.recurring ? '  🔁' : ''}</Text>
                  <View style={{ flexDirection: 'row-reverse', gap: 8, alignItems: 'center' }}>
                    <TouchableOpacity onPress={() => toggleRecurring(t)} testID={`fee-type-recurring-${t.id}`}
                      style={{ backgroundColor: t.recurring ? '#e8f5e9' : '#f0f0f0', borderRadius: 12, paddingVertical: 3, paddingHorizontal: 8 }}>
                      <Text style={{ fontSize: 10, fontWeight: '800', color: t.recurring ? '#2e7d32' : '#666' }}>{t.recurring ? 'شهري 🔁' : 'سنوي'}</Text>
                    </TouchableOpacity>
                    {!t.builtin && (
                      <TouchableOpacity onPress={async () => { await api.delete(`/fees/types/${t.id}`); load(); }} testID={`fee-type-del-${t.id}`}>
                        <Ionicons name="trash" size={16} color="#c62828" />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              ))}
              <TouchableOpacity onPress={() => setNewTypeRecurring(!newTypeRecurring)} testID="fee-type-recurring-check"
                style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6, marginTop: 10 }}>
                <Ionicons name={newTypeRecurring ? 'checkbox' : 'square-outline'} size={18} color="#1565c0" />
                <Text style={{ fontSize: 12 }}>رسوم متكررة (شهرية) — تسمح بدفعات متعددة كلٌّ ببيانها</Text>
              </TouchableOpacity>
              <View style={{ flexDirection: 'row-reverse', gap: 6, marginTop: 10 }}>
                <TextInput value={newType} onChangeText={setNewType} placeholder="نوع جديد (مثال: رسوم مختبر)"
                  style={{ flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 8, textAlign: 'right', fontSize: 12 }} testID="fee-type-input" />
                <TouchableOpacity onPress={addType} style={{ backgroundColor: '#1565c0', borderRadius: 8, padding: 10 }} testID="fee-type-add-btn">
                  <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>إضافة</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity onPress={() => setShowTypes(false)} style={{ marginTop: 10, padding: 6 }}>
                <Text style={{ textAlign: 'center', color: '#1565c0', fontWeight: '800' }}>إغلاق</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </>
  );
}
