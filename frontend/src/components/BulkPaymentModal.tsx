import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView, ActivityIndicator, Platform, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../services/api';

const notify = (msg: string) => { if (Platform.OS === 'web') window.alert(msg); else Alert.alert('', msg); };
const today = () => new Date().toISOString().slice(0, 10);
const inp = { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 8, textAlign: 'right' as const, fontSize: 12, backgroundColor: '#fff' };
const selStyle: any = { padding: 7, borderRadius: 8, border: '1px solid #ddd', fontSize: 12, fontFamily: 'inherit', background: '#fff', minWidth: 140 };

type Student = { id: string; full_name: string; student_id?: string; level?: number; section?: string; department_name?: string; paid?: boolean };
type Props = {
  visible: boolean;
  onClose: () => void;
  onDone?: () => void;
  // وضع (أ): طلاب محددون مسبقاً من شاشة الطلاب
  preselected?: Student[];
  // وضع (ب): اختيار القسم/المستوى/الشعبة داخل النافذة
  departments?: { id: string; name: string }[];
};

// 💰 نافذة «اعتبار مجموعة طلاب دافعين» — مشتركة بين شاشة الطلاب وشاشة السندات
export const BulkPaymentModal = ({ visible, onClose, onDone, preselected, departments = [] }: Props) => {
  const pickerMode = !preselected;
  const [types, setTypes] = useState<any[]>([]);
  const [typeId, setTypeId] = useState('');
  const [otherLabel, setOtherLabel] = useState('');
  const [statement, setStatement] = useState('');
  const [prefix, setPrefix] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [dept, setDept] = useState('');
  const [level, setLevel] = useState('');
  const [section, setSection] = useState('');
  const [list, setList] = useState<Student[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<any>(null);

  const selectedType = types.find((t) => t.id === typeId);
  const recurring = !!selectedType?.recurring;

  useEffect(() => {
    if (!visible) return;
    setResult(null);
    api.get('/fees/types').then((r) => {
      const ts = r.data.types || [];
      setTypes(ts);
      if (!typeId && ts[0]) setTypeId(ts[0].id);
    }).catch(() => {});
  }, [visible]);

  // وضع (أ): افحص من دفع مسبقاً بين المحددين
  const loadStatus = useCallback(async () => {
    if (!typeId) return;
    setLoading(true);
    try {
      const params: any = { type_id: typeId };
      if (recurring && statement.trim()) params.statement = statement.trim();
      if (pickerMode) {
        if (dept) params.department_id = dept;
        if (level) params.level = parseInt(level, 10);
        if (section) params.section = section;
      }
      const r = await api.get('/fees/unpaid-students', { params });
      const all: Student[] = r.data.students || [];
      if (pickerMode) {
        setList(all);
        setChecked(new Set(all.filter((s) => !s.paid).map((s) => s.id)));
      } else {
        const paidSet = new Set(all.filter((s) => s.paid).map((s) => s.id));
        const merged = (preselected || []).map((s) => ({ ...s, paid: paidSet.has(s.id) }));
        setList(merged);
        setChecked(new Set(merged.filter((s) => !s.paid).map((s) => s.id)));
      }
    } catch { notify('فشل تحميل الطلاب'); }
    finally { setLoading(false); }
  }, [typeId, recurring, statement, pickerMode, dept, level, section, preselected]);

  useEffect(() => {
    if (!visible || !typeId) return;
    if (pickerMode && !dept) { setList([]); setChecked(new Set()); return; }
    const t = setTimeout(loadStatus, 300);
    return () => clearTimeout(t);
  }, [visible, typeId, dept, level, section, statement, loadStatus, pickerMode]);

  const unpaid = useMemo(() => list.filter((s) => !s.paid), [list]);
  const paidCount = list.length - unpaid.length;
  const toggle = (id: string) => setChecked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const [sections, setSections] = useState<string[]>([]);
  useEffect(() => { if (!section) setSections(Array.from(new Set(list.map((s) => s.section).filter(Boolean))) as string[]); }, [list, section]);

  const submit = async () => {
    if (!typeId) { notify('اختر نوع الرسوم'); return; }
    if (typeId === 'other' && !otherLabel.trim()) { notify('اكتب نوع الرسوم في الحقل الحر'); return; }
    if (recurring && !statement.trim()) { notify(`«${selectedType?.name}» رسوم متكررة — اكتب بيان الدفعة`); return; }
    if (checked.size === 0) { notify('لم يتم تحديد أي طالب'); return; }
    const msg = `سيتم تسجيل ${checked.size} طالباً دافعين لـ«${typeId === 'other' ? otherLabel : selectedType?.name}»${paidCount ? ` — ${paidCount} دافعون مسبقاً سيُتخطَّون` : ''}. متابعة؟`;
    if (Platform.OS === 'web' ? !window.confirm(msg) : false) return;
    setSubmitting(true);
    try {
      const r = await api.post('/fees/manual-payment/bulk', {
        student_ids: Array.from(checked), type_id: typeId, other_label: otherLabel.trim(),
        receipt_no_prefix: prefix.trim(), amount: amount.trim(), receipt_date: date.trim(), statement: statement.trim(),
      });
      setResult(r.data);
      onDone?.();
    } catch (e: any) { notify(e?.response?.data?.detail || 'فشلت العملية'); }
    finally { setSubmitting(false); }
  };

  const downloadResult = () => {
    if (!result || Platform.OS !== 'web') return;
    const rows = [['الحالة', 'الاسم', 'رقم القيد', 'رقم السند', 'السبب'],
      ...result.done.map((d: any) => ['تم', d.name, d.student_id, d.receipt_no, '']),
      ...result.skipped.map((d: any) => ['تخطي', d.name, '', '', d.reason])];
    const csv = '\uFEFF' + rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const d = new Date(); const pad = (n: number) => String(n).padStart(2, '0');
    a.download = `نتيجة الدفع الجماعي - ${result.type_name} - ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}.csv`;
    a.click();
  };

  const close = () => { setResult(null); setList([]); setChecked(new Set()); onClose(); };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 16 }}>
        <View style={{ backgroundColor: '#f7f9fc', borderRadius: 14, padding: 16, width: '100%', maxWidth: 720, maxHeight: '92%' }} testID="bulk-payment-modal">
          <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <Text style={{ fontWeight: '900', fontSize: 15 }}>💰 اعتبار مجموعة طلاب دافعين</Text>
            <TouchableOpacity onPress={close} testID="bulk-payment-close"><Ionicons name="close" size={22} color="#666" /></TouchableOpacity>
          </View>

          {result ? (
            <ScrollView>
              <View style={{ backgroundColor: '#e8f5e9', borderRadius: 10, padding: 12, marginBottom: 10 }} testID="bulk-payment-result">
                <Text style={{ fontWeight: '900', color: '#2e7d32', textAlign: 'right' }}>{result.message}</Text>
              </View>
              {result.skipped?.length > 0 && (
                <View style={{ backgroundColor: '#fff8e1', borderRadius: 10, padding: 10, marginBottom: 10 }}>
                  <Text style={{ fontWeight: '800', textAlign: 'right', marginBottom: 4 }}>المتخطَّون ({result.skipped.length}):</Text>
                  {result.skipped.map((s: any) => <Text key={s.id} style={{ fontSize: 12, textAlign: 'right', color: '#5d4037' }}>• {s.name || s.id} — {s.reason}</Text>)}
                </View>
              )}
              <View style={{ flexDirection: 'row-reverse', gap: 8 }}>
                {Platform.OS === 'web' && (
                  <TouchableOpacity onPress={downloadResult} style={{ flex: 1, backgroundColor: '#1565c0', borderRadius: 8, padding: 10 }} testID="bulk-payment-download">
                    <Text style={{ color: '#fff', fontWeight: '800', textAlign: 'center' }}>📥 تنزيل التقرير</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={close} style={{ flex: 1, backgroundColor: '#2e7d32', borderRadius: 8, padding: 10 }} testID="bulk-payment-finish">
                  <Text style={{ color: '#fff', fontWeight: '800', textAlign: 'center' }}>تم</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          ) : (
            <ScrollView>
              <Text style={{ fontWeight: '800', textAlign: 'right', fontSize: 12, marginBottom: 6 }}>نوع الرسوم:</Text>
              <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {types.map((t) => (
                  <TouchableOpacity key={t.id} onPress={() => setTypeId(t.id)} testID={`bulk-type-${t.id}`}
                    style={{ backgroundColor: typeId === t.id ? '#1565c0' : '#fff', borderRadius: 20, paddingVertical: 6, paddingHorizontal: 12, borderWidth: 1, borderColor: '#1565c0' }}>
                    <Text style={{ color: typeId === t.id ? '#fff' : '#1565c0', fontWeight: '800', fontSize: 12 }}>{t.name}{t.recurring ? ' 🔁' : ''}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {typeId === 'other' && <TextInput value={otherLabel} onChangeText={setOtherLabel} placeholder="نوع الرسوم (حر)" style={[inp, { marginBottom: 8 }]} testID="bulk-other-label" />}
              <TextInput value={statement} onChangeText={setStatement} placeholder={recurring ? 'بيان الدفعة (مطلوب للرسوم المتكررة)' : 'بيان الدفعة (اختياري)'} style={[inp, { marginBottom: 8 }]} testID="bulk-statement" />
              <View style={{ flexDirection: 'row-reverse', gap: 8, marginBottom: 8 }}>
                <TextInput value={prefix} onChangeText={setPrefix} placeholder="بادئة رقم السند (اختياري) مثل BULK-2026" style={[inp, { flex: 1 }]} testID="bulk-prefix" />
                <TextInput value={amount} onChangeText={setAmount} placeholder="المبلغ (اختياري)" style={[inp, { flex: 1 }]} testID="bulk-amount" />
                <TextInput value={date} onChangeText={setDate} placeholder="التاريخ YYYY-MM-DD" style={[inp, { flex: 1 }]} testID="bulk-date" />
              </View>
              {!!prefix.trim() && <Text style={{ fontSize: 11, color: '#607d8b', textAlign: 'right', marginBottom: 6 }}>سيُولَّد لكل طالب رقم متسلسل: {prefix.trim()}-001، {prefix.trim()}-002 …</Text>}

              {pickerMode && Platform.OS === 'web' && (
                <View style={{ flexDirection: 'row-reverse', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  <select value={dept} onChange={(e: any) => { setDept(e.target.value); setLevel(''); setSection(''); }} data-testid="bulk-dept" style={selStyle}>
                    <option value="">اختر القسم…</option>
                    {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                  <select value={level} onChange={(e: any) => setLevel(e.target.value)} data-testid="bulk-level" style={selStyle}>
                    <option value="">كل المستويات</option>
                    {[1, 2, 3, 4, 5, 6].map((l) => <option key={l} value={String(l)}>المستوى {l}</option>)}
                  </select>
                  <select value={section} onChange={(e: any) => setSection(e.target.value)} data-testid="bulk-section" style={selStyle}>
                    <option value="">كل الشعب</option>
                    {sections.map((sc) => <option key={sc} value={sc}>شعبة {sc}</option>)}
                  </select>
                </View>
              )}

              <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <Text style={{ fontWeight: '800', fontSize: 12 }} testID="bulk-summary">
                  {loading ? 'جارٍ التحميل…' : `المحدد: ${checked.size} من ${unpaid.length} غير دافع${paidCount ? ` — ${paidCount} دافعون مسبقاً (يُتخطَّون)` : ''}`}
                </Text>
                {unpaid.length > 0 && (
                  <TouchableOpacity onPress={() => setChecked(checked.size === unpaid.length ? new Set() : new Set(unpaid.map((s) => s.id)))} testID="bulk-select-all">
                    <Text style={{ color: '#1565c0', fontWeight: '800', fontSize: 12 }}>{checked.size === unpaid.length ? 'إلغاء تحديد الكل' : 'تحديد الكل'}</Text>
                  </TouchableOpacity>
                )}
              </View>
              <View style={{ maxHeight: 260, backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#e3e8ef' }}>
                <ScrollView nestedScrollEnabled>
                  {loading && <ActivityIndicator style={{ margin: 12 }} color="#1565c0" />}
                  {!loading && list.length === 0 && <Text style={{ textAlign: 'center', color: '#999', padding: 14, fontSize: 12 }}>{pickerMode && !dept ? 'اختر القسم لعرض الطلاب' : 'لا يوجد طلاب'}</Text>}
                  {list.map((st) => (
                    <TouchableOpacity key={st.id} disabled={st.paid} onPress={() => toggle(st.id)} testID={`bulk-student-${st.id}`}
                      style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8, paddingVertical: 7, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: '#f0f2f5', opacity: st.paid ? 0.5 : 1 }}>
                      <Ionicons name={st.paid ? 'checkmark-done-circle' : checked.has(st.id) ? 'checkbox' : 'square-outline'} size={20} color={st.paid ? '#9e9e9e' : '#1565c0'} />
                      <Text style={{ flex: 1, textAlign: 'right', fontSize: 12, fontWeight: '700' }}>{st.full_name}</Text>
                      <Text style={{ fontSize: 11, color: '#607d8b' }}>{st.student_id}{st.level ? ` · م${st.level}` : ''}{st.section ? ` · ${st.section}` : ''}</Text>
                      {st.paid && <Text style={{ fontSize: 10, color: '#9e9e9e', fontWeight: '800' }}>دافع مسبقاً</Text>}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              <TouchableOpacity disabled={submitting || checked.size === 0} onPress={submit} testID="bulk-payment-submit"
                style={{ backgroundColor: checked.size === 0 ? '#9e9e9e' : '#2e7d32', borderRadius: 10, padding: 13, marginTop: 12 }}>
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '900', textAlign: 'center' }}>✅ اعتبارهم دافعين ({checked.size})</Text>}
              </TouchableOpacity>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
};
