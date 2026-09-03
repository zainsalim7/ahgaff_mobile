import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Platform, Alert, ScrollView } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '../src/services/api';

const notify = (msg: string) => { if (Platform.OS === 'web') window.alert(msg); else Alert.alert('', msg); };
const today = () => new Date().toISOString().slice(0, 10);
const monthAgo = () => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); };

const DateField = ({ value, onChange, label, testID }: any) => (
  <View style={{ flex: 1 }}>
    <Text style={{ fontSize: 11, color: '#555', textAlign: 'right', marginBottom: 3, fontWeight: '700' }}>{label}</Text>
    {Platform.OS === 'web' ? (
      // 📅 منتقي تاريخ ديناميكي أصلي على الويب
      React.createElement('input', {
        type: 'date', value, 'data-testid': testID,
        onChange: (e: any) => onChange(e.target.value),
        style: { padding: 9, borderRadius: 8, border: '1px solid #ddd', fontSize: 13, width: '100%', fontFamily: 'inherit', direction: 'ltr', textAlign: 'center', backgroundColor: '#fff' },
      })
    ) : (
      <TextInput value={value} onChangeText={onChange} placeholder="YYYY-MM-DD" testID={testID}
        style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 8, textAlign: 'center', fontSize: 12, backgroundColor: '#fff' }} />
    )}
  </View>
);

export default function PaymentsReportScreen() {
  const params = useLocalSearchParams<{ studentIds?: string; names?: string }>();
  const initial = (params.studentIds || '').split(',').filter(Boolean).map((id, i) => ({
    id, full_name: ((params.names || '').split('،')[i] || '').trim() || `طالب ${i + 1}`,
  }));
  const [students, setStudents] = useState<any[]>(initial);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [from, setFrom] = useState(monthAgo());
  const [to, setTo] = useState(today());
  const [rows, setRows] = useState<any[] | null>(null);
  const [total, setTotal] = useState(0);

  const doSearch = async (txt: string) => {
    setSearch(txt);
    if (txt.trim().length < 2) { setResults([]); return; }
    try {
      const r = await api.get('/students', { params: { search: txt.trim() } });
      const list = Array.isArray(r.data) ? r.data : (r.data.students || []);
      const q = txt.trim();
      setResults(list.filter((s: any) => (s.full_name || '').includes(q) || (s.student_id || '').includes(q)).slice(0, 8));
    } catch { setResults([]); }
  };

  const preview = async () => {
    try {
      const r = await api.get('/fees/payment-report', {
        params: { date_from: from, date_to: to, fmt: 'json', student_ids: students.map((s) => s.id).join(',') || undefined },
      });
      setRows(r.data.rows || []); setTotal(r.data.total_amount || 0);
    } catch { notify('فشل جلب التقرير'); }
  };

  const download = async (fmt: 'excel' | 'pdf') => {
    try {
      const r = await api.get('/fees/payment-report', {
        params: { date_from: from, date_to: to, fmt, student_ids: students.map((s) => s.id).join(',') || undefined },
        responseType: 'blob',
      });
      if (Platform.OS === 'web') {
        const url = window.URL.createObjectURL(new Blob([r.data]));
        const a = document.createElement('a');
        a.href = url; a.download = `تقرير_السدادات_${from}_${to}.${fmt === 'excel' ? 'xlsx' : 'pdf'}`; a.click();
        window.URL.revokeObjectURL(url);
      }
    } catch { notify('فشل التصدير'); }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'تقرير السدادات' }} />
      <SafeAreaView style={{ flex: 1, backgroundColor: '#f5f7fa' }} edges={['bottom']}>
        <ScrollView contentContainerStyle={{ padding: 16, maxWidth: 950, width: '100%', alignSelf: 'center' }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 14 }}>
            <View style={{ flexDirection: 'row-reverse', gap: 10 }}>
              <DateField label="من تاريخ" value={from} onChange={setFrom} testID="pr-from" />
              <DateField label="إلى تاريخ" value={to} onChange={setTo} testID="pr-to" />
            </View>
            <TextInput value={search} onChangeText={doSearch} placeholder="أضف طالباً بالاسم أو رقم القيد (فارغ = كل الطلاب)..."
              style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 9, textAlign: 'right', fontSize: 12, marginTop: 10 }} testID="pr-search" />
            {results.map((s) => (
              <TouchableOpacity key={s.id} testID={`pr-student-${s.id}`}
                onPress={() => { if (!students.find((x) => x.id === s.id)) setStudents([...students, s]); setResults([]); setSearch(''); }}
                style={{ padding: 8, borderBottomWidth: 1, borderColor: '#f0f0f0' }}>
                <Text style={{ textAlign: 'right', fontSize: 12 }}>{s.full_name} — {s.student_id}</Text>
              </TouchableOpacity>
            ))}
            <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {students.map((s) => (
                <TouchableOpacity key={s.id} onPress={() => setStudents(students.filter((x) => x.id !== s.id))} testID={`pr-chip-${s.id}`}
                  style={{ backgroundColor: '#e3f2fd', borderRadius: 14, paddingVertical: 4, paddingHorizontal: 10 }}>
                  <Text style={{ fontSize: 11, color: '#1565c0', fontWeight: '700' }}>{s.full_name} ✕</Text>
                </TouchableOpacity>
              ))}
              {students.length === 0 && <Text style={{ fontSize: 11, color: '#999' }}>لم يُحدد طلاب — التقرير سيشمل الجميع</Text>}
            </View>
            <View style={{ flexDirection: 'row-reverse', gap: 8, marginTop: 12 }}>
              <TouchableOpacity onPress={preview} testID="pr-preview"
                style={{ flex: 1, backgroundColor: '#1565c0', borderRadius: 8, padding: 12 }}>
                <Text style={{ color: '#fff', fontWeight: '800', textAlign: 'center' }}>👁 معاينة</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => download('excel')} testID="pr-excel"
                style={{ flex: 1, backgroundColor: '#2e7d32', borderRadius: 8, padding: 12 }}>
                <Text style={{ color: '#fff', fontWeight: '800', textAlign: 'center' }}>📄 Excel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => download('pdf')} testID="pr-pdf"
                style={{ flex: 1, backgroundColor: '#c62828', borderRadius: 8, padding: 12 }}>
                <Text style={{ color: '#fff', fontWeight: '800', textAlign: 'center' }}>📕 PDF</Text>
              </TouchableOpacity>
            </View>
          </View>

          {rows !== null && (
            <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 14, marginTop: 12 }} testID="pr-results">
              <Text style={{ textAlign: 'right', fontWeight: '800', fontSize: 13 }}>النتائج: {rows.length} سداداً — الإجمالي: {total.toLocaleString()}</Text>
              {rows.map((d: any) => (
                <View key={d.id} style={{ borderBottomWidth: 1, borderColor: '#f0f0f0', paddingVertical: 6 }}>
                  <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 12, fontWeight: '800' }}>{d.student_name} — {d.type_name}{d.statement ? ` (${d.statement})` : ''}</Text>
                    <Text style={{ fontSize: 11, color: '#1565c0', fontWeight: '800' }}>{d.amount || '—'}</Text>
                  </View>
                  <Text style={{ textAlign: 'right', fontSize: 10, color: '#666' }}>
                    📅 {d.date} | {d.student_number} | {d.department_name}{d.receipt_no ? ` | سند ${d.receipt_no}` : ''} | {d.status_label}{d.manual_entry ? ' (يدوي)' : ''}
                  </Text>
                </View>
              ))}
              {rows.length === 0 && <Text style={{ textAlign: 'center', color: '#999', marginTop: 10 }}>لا سدادات في هذا المدى</Text>}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </>
  );
}
