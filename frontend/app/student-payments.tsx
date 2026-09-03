import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Platform, Alert, ScrollView } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '../src/services/api';

const notify = (msg: string) => { if (Platform.OS === 'web') window.alert(msg); else Alert.alert('', msg); };
const STATUS_COLORS: any = { approved: '#2e7d32', pending: '#f57f17', rejected: '#c62828' };

export default function StudentPaymentsScreen() {
  const { studentId, name } = useLocalSearchParams<{ studentId: string; name: string }>();
  const [receipts, setReceipts] = useState<any[]>([]);
  const [types, setTypes] = useState<any[]>([]);
  const [showPay, setShowPay] = useState(false);
  const [pType, setPType] = useState<any>(null);
  const [pOther, setPOther] = useState('');
  const [pStatement, setPStatement] = useState('');
  const [pReceiptNo, setPReceiptNo] = useState('');
  const [pAmount, setPAmount] = useState('');
  const [pDate, setPDate] = useState('');
  const [rFrom, setRFrom] = useState('');
  const [rTo, setRTo] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, t] = await Promise.all([
        api.get(`/fees/students/${studentId}/receipts`),
        api.get('/fees/types'),
      ]);
      setReceipts(r.data.receipts || []);
      setTypes(t.data.types || []);
    } catch { notify('فشل التحميل — تأكد من صلاحية إدارة السندات المالية'); }
  }, [studentId]);
  useEffect(() => { load(); }, [load]);

  const submitPay = async () => {
    if (!pType) { notify('اختر نوع الرسوم'); return; }
    setLoading(true);
    try {
      const r = await api.post('/fees/manual-payment', {
        student_id: studentId, type_id: pType.id, other_label: pOther,
        statement: pStatement, receipt_no: pReceiptNo, amount: pAmount, receipt_date: pDate,
        notes: 'تسجيل يدوي من جدول الطلاب',
      });
      notify(r.data.message);
      setShowPay(false); setPType(null); setPOther(''); setPStatement(''); setPReceiptNo(''); setPAmount(''); setPDate('');
      load();
    } catch (e: any) { notify(e?.response?.data?.detail || 'فشلت العملية'); }
    finally { setLoading(false); }
  };

  const exportReport = async (fmt: 'excel' | 'pdf') => {
    const from = rFrom || '2000-01-01';
    const to = rTo || '2100-01-01';
    try {
      const r = await api.get('/fees/payment-report', {
        params: { date_from: from, date_to: to, fmt, student_ids: studentId }, responseType: 'blob',
      });
      if (Platform.OS === 'web') {
        const url = window.URL.createObjectURL(new Blob([r.data]));
        const a = document.createElement('a');
        a.href = url; a.download = `سدادات_${name || 'طالب'}.${fmt === 'excel' ? 'xlsx' : 'pdf'}`; a.click();
        window.URL.revokeObjectURL(url);
      }
    } catch { notify('فشل التصدير'); }
  };

  return (
    <>
      <Stack.Screen options={{ title: `سدادات — ${name || ''}` }} />
      <SafeAreaView style={{ flex: 1, backgroundColor: '#f5f7fa' }} edges={['bottom']}>
        <ScrollView contentContainerStyle={{ padding: 16, maxWidth: 900, width: '100%', alignSelf: 'center' }}>
          <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, marginBottom: 12, alignItems: 'center' }}>
            <TouchableOpacity onPress={() => setShowPay(!showPay)} testID="sp-pay-btn"
              style={{ backgroundColor: '#2e7d32', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16 }}>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>✍️ تسجيل دفع يدوي</Text>
            </TouchableOpacity>
            <TextInput value={rFrom} onChangeText={setRFrom} placeholder="من (اختياري)"
              style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 8, textAlign: 'right', fontSize: 11, width: 110, backgroundColor: '#fff' }} testID="sp-from" />
            <TextInput value={rTo} onChangeText={setRTo} placeholder="إلى (اختياري)"
              style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 8, textAlign: 'right', fontSize: 11, width: 110, backgroundColor: '#fff' }} testID="sp-to" />
            <TouchableOpacity onPress={() => exportReport('excel')} testID="sp-excel"
              style={{ backgroundColor: '#e8f5e9', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12 }}>
              <Text style={{ color: '#2e7d32', fontWeight: '800', fontSize: 12 }}>📄 Excel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => exportReport('pdf')} testID="sp-pdf"
              style={{ backgroundColor: '#ffebee', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12 }}>
              <Text style={{ color: '#c62828', fontWeight: '800', fontSize: 12 }}>📕 PDF</Text>
            </TouchableOpacity>
          </View>

          {showPay && (
            <View style={{ backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 12 }} testID="sp-pay-form">
              <Text style={{ textAlign: 'right', fontSize: 12, fontWeight: '800' }}>نوع الرسوم:</Text>
              <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                {types.map((t: any) => (
                  <TouchableOpacity key={t.id} onPress={() => setPType(t)} testID={`sp-type-${t.id}`}
                    style={{ backgroundColor: pType?.id === t.id ? '#1565c0' : '#f0f0f0', borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12 }}>
                    <Text style={{ color: pType?.id === t.id ? '#fff' : '#333', fontSize: 11, fontWeight: '700' }}>{t.name}{t.recurring ? ' 🔁' : ''}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {pType?.id === 'other' && (
                <TextInput value={pOther} onChangeText={setPOther} placeholder="اكتب نوع الرسوم..."
                  style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 8, textAlign: 'right', fontSize: 12, marginTop: 6 }} testID="sp-other" />
              )}
              <TextInput value={pStatement} onChangeText={setPStatement}
                placeholder={pType?.recurring ? 'بيان الدفعة (إلزامي — مثال: تغذية شهر يناير)' : 'بيان الدفعة (اختياري)'}
                style={{ borderWidth: 1, borderColor: pType?.recurring ? '#f57f17' : '#ddd', borderRadius: 8, padding: 8, textAlign: 'right', fontSize: 12, marginTop: 6 }} testID="sp-statement" />
              <View style={{ flexDirection: 'row-reverse', gap: 6, marginTop: 6 }}>
                <TextInput value={pReceiptNo} onChangeText={setPReceiptNo} placeholder="رقم السند"
                  style={{ flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 8, textAlign: 'right', fontSize: 12 }} testID="sp-receiptno" />
                <TextInput value={pAmount} onChangeText={setPAmount} placeholder="المبلغ"
                  style={{ flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 8, textAlign: 'right', fontSize: 12 }} testID="sp-amount" />
                <TextInput value={pDate} onChangeText={setPDate} placeholder="التاريخ YYYY-MM-DD"
                  style={{ flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 8, textAlign: 'right', fontSize: 12 }} testID="sp-date" />
              </View>
              <TouchableOpacity disabled={loading} onPress={submitPay} testID="sp-submit"
                style={{ backgroundColor: '#2e7d32', borderRadius: 8, padding: 12, marginTop: 10 }}>
                <Text style={{ color: '#fff', fontWeight: '800', textAlign: 'center' }}>✅ اعتباره دافعاً</Text>
              </TouchableOpacity>
            </View>
          )}

          <Text style={{ textAlign: 'right', fontWeight: '800', fontSize: 13, marginBottom: 8 }}>💰 سجل السدادات ({receipts.length})</Text>
          {receipts.length === 0 && <Text style={{ textAlign: 'center', color: '#999', marginTop: 20 }}>لا توجد سدادات مسجلة</Text>}
          {receipts.map((r) => (
            <View key={r.id} style={{ backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 }} testID={`sp-receipt-${r.id}`}>
              <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between' }}>
                <Text style={{ fontWeight: '800', fontSize: 13 }}>{r.type_name}{r.statement ? ` — ${r.statement}` : ''}</Text>
                <Text style={{ fontSize: 11, fontWeight: '800', color: STATUS_COLORS[r.status] || '#666' }}>{r.status_label}</Text>
              </View>
              <Text style={{ textAlign: 'right', fontSize: 11, color: '#666', marginTop: 3 }}>
                العام: {r.academic_year || '—'}
                {r.receipt_date ? ` | 📅 ${r.receipt_date}` : ''}
                {r.receipt_no ? ` | سند ${r.receipt_no}` : ''}
                {r.amount ? ` | ${r.amount}` : ''}
                {r.reviewed_by ? ` | عمّده: ${r.reviewed_by}` : ''}
              </Text>
              {r.manual_entry && <Text style={{ textAlign: 'right', fontSize: 10, color: '#2e7d32', fontWeight: '800', marginTop: 2 }}>✍️ تسجيل يدوي من الإدارة</Text>}
              {r.date_warning && <Text style={{ textAlign: 'right', fontSize: 10, color: '#f57f17', fontWeight: '800', marginTop: 2 }}>⚠️ تاريخ السند خارج عامه الجامعي</Text>}
              {r.status === 'rejected' && !!r.rejection_reason && <Text style={{ textAlign: 'right', fontSize: 10, color: '#c62828', marginTop: 2 }}>سبب الرفض: {r.rejection_reason}</Text>}
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    </>
  );
}
