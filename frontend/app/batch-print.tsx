import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView,
  Platform, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Picker } from '@react-native-picker/picker';
import api from '../src/services/api';

// معاينة A4 مصغّرة: 210×297مم → مقياس
const SCALE = 1.35;
const A4W = 210 * SCALE;
const A4H = 297 * SCALE;

const DEFAULTS = { card_w: 85.6, card_h: 54, card1_x: 62, card1_y: 40, card2_x: 62, card2_y: 180 };

export default function BatchPrintScreen() {
  const [faculties, setFaculties] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [facultyId, setFacultyId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [level, setLevel] = useState('');
  const [count, setCount] = useState<{ count: number; pages: number } | null>(null);
  const [st, setSt] = useState<any>({ ...DEFAULTS });
  const [template, setTemplate] = useState('green');
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [facRes, setRes] = await Promise.all([
          api.get('/faculties'),
          api.get('/cards/print-settings'),
        ]);
        const list = (facRes.data || []).map((f: any) => ({ id: f.id || f._id, name: f.name }));
        setFaculties(list);
        if (list.length > 0) setFacultyId(list[0].id);
        setSt({ ...DEFAULTS, ...setRes.data });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!facultyId) return;
    api.get(`/cards/settings/${facultyId}`).then((r) => setTemplate(r.data?.template || 'green')).catch(() => setTemplate('green'));
    api.get('/departments', { params: { faculty_id: facultyId } }).then((r) => {
      const list = (r.data || []).filter((d: any) => !facultyId || d.faculty_id === facultyId);
      setDepartments(list);
      setDepartmentId(list[0]?.id || '');
    });
  }, [facultyId]);

  const refreshCount = useCallback(() => {
    if (!departmentId) { setCount(null); return; }
    api.get('/cards/batch-count', { params: { department_id: departmentId, ...(level ? { level } : {}) } })
      .then((r) => setCount(r.data)).catch(() => setCount(null));
  }, [departmentId, level]);

  useEffect(() => { refreshCount(); }, [refreshCount]);

  const setNum = (key: string) => (t: string) => {
    const v = t.replace(/[^0-9.]/g, '');
    setSt((p: any) => ({ ...p, [key]: v }));
  };

  const download = async () => {
    setDownloading(true);
    setMsg('');
    try {
      const settings: any = {};
      Object.keys(DEFAULTS).forEach((k) => { settings[k] = parseFloat(st[k]) || (DEFAULTS as any)[k]; });
      const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
      const res = await api.post('/cards/batch-pdf', {
        department_id: departmentId,
        level: level ? parseInt(level, 10) : undefined,
        base_url: baseUrl,
        settings,
      }, { responseType: 'blob', timeout: 300000 });
      if (Platform.OS === 'web') {
        const url = window.URL.createObjectURL(new Blob([res.data]));
        const a = document.createElement('a');
        a.href = url;
        a.download = 'batch_cards.pdf';
        a.click();
        window.URL.revokeObjectURL(url);
      }
      setMsg('✅ تم إنشاء الملف وحفظ إعدادات المواضع');
    } catch (e: any) {
      let detail = e?.response?.data?.detail;
      if (e?.response?.data instanceof Blob) {
        try { detail = JSON.parse(await e.response.data.text()).detail; } catch {}
      }
      setMsg(detail || 'فشل إنشاء الملف');
    } finally {
      setDownloading(false);
    }
  };

  const NumField = ({ label, k }: { label: string; k: string }) => (
    <View style={{ flex: 1, minWidth: 100 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={String(st[k])}
        onChangeText={setNum(k)}
        keyboardType="numeric"
        style={styles.input}
        testID={`print-${k}-input`}
      />
    </View>
  );

  if (loading) {
    return <SafeAreaView style={styles.container}><ActivityIndicator size="large" color="#00796b" style={{ marginTop: 60 }} /></SafeAreaView>;
  }

  const n = (k: string) => parseFloat(st[k]) || 0;
  const portrait = template !== 'horizontal';
  const pw = portrait ? n('card_h') : n('card_w');
  const ph = portrait ? n('card_w') : n('card_h');

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <View style={styles.row}>
          {/* ===== الإعدادات ===== */}
          <View style={styles.panel}>
            <Text style={styles.title}>🖨️ طباعة البطاقات دفعة واحدة</Text>
            <Text style={styles.hint}>بطاقتان في كل ورقة A4 — اضبط مواضعهما بالملم لتطابق طابعتك، وتُحفظ الإعدادات تلقائياً.</Text>

            <Text style={styles.label}>الكلية</Text>
            <View style={styles.pickerWrap}>
              <Picker selectedValue={facultyId} onValueChange={(v) => setFacultyId(String(v))} style={{ height: 40 }} testID="print-faculty-picker">
                {faculties.map((f) => <Picker.Item key={f.id} label={f.name} value={f.id} />)}
              </Picker>
            </View>

            <Text style={styles.label}>القسم</Text>
            <View style={styles.pickerWrap}>
              <Picker selectedValue={departmentId} onValueChange={(v) => setDepartmentId(String(v))} style={{ height: 40 }} testID="print-department-picker">
                {departments.map((d) => <Picker.Item key={d.id} label={d.name} value={d.id} />)}
              </Picker>
            </View>

            <Text style={styles.label}>المستوى (اختياري — فارغ = كل المستويات)</Text>
            <View style={styles.pickerWrap}>
              <Picker selectedValue={level} onValueChange={(v) => setLevel(String(v))} style={{ height: 40 }} testID="print-level-picker">
                <Picker.Item label="كل المستويات" value="" />
                {[1, 2, 3, 4, 5, 6, 7, 8].map((l) => <Picker.Item key={l} label={`المستوى ${l}`} value={String(l)} />)}
              </Picker>
            </View>

            {count && (
              <View style={styles.countBox} testID="print-count-box">
                <Ionicons name="people" size={15} color="#00796b" />
                <Text style={styles.countText}>{count.count} طالباً → {count.pages} ورقة A4</Text>
              </View>
            )}

            <Text style={styles.sectionTitle}>مقاس البطاقة (ملم)</Text>
            <View style={styles.fieldsRow}>
              <NumField label="العرض" k="card_w" />
              <NumField label="الارتفاع" k="card_h" />
            </View>

            <Text style={styles.sectionTitle}>موضع البطاقة الأولى (العلوية)</Text>
            <View style={styles.fieldsRow}>
              <NumField label="من اليسار (X)" k="card1_x" />
              <NumField label="من الأعلى (Y)" k="card1_y" />
            </View>

            <Text style={styles.sectionTitle}>موضع البطاقة الثانية (السفلية)</Text>
            <View style={styles.fieldsRow}>
              <NumField label="من اليسار (X)" k="card2_x" />
              <NumField label="من الأعلى (Y)" k="card2_y" />
            </View>

            {!!msg && <Text style={styles.msg} testID="print-msg">{msg}</Text>}

            <TouchableOpacity
              onPress={download}
              disabled={downloading || !departmentId || !count?.count}
              style={[styles.dlBtn, (downloading || !departmentId || !count?.count) && { opacity: 0.6 }]}
              testID="batch-print-download-btn"
            >
              {downloading ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="print" size={17} color="#fff" />}
              <Text style={styles.dlBtnText}>{downloading ? 'جارٍ إنشاء الملف...' : 'تنزيل PDF للطباعة'}</Text>
            </TouchableOpacity>
          </View>

          {/* ===== معاينة A4 ===== */}
          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>معاينة الورقة A4</Text>
            <Text style={{ fontSize: 10.5, color: '#5b6678', textAlign: 'right', marginBottom: 6 }}>
              قالب الكلية: {template === 'horizontal' ? 'أفقي' : 'عمودي'} — تُطبع البطاقة {portrait ? 'بالطول' : 'بالعرض'} تلقائياً
            </Text>
            <View style={[styles.a4, { width: A4W, height: A4H }]} testID="a4-preview">
              {[1, 2].map((i) => (
                <View
                  key={i}
                  style={{
                    position: 'absolute',
                    left: n(`card${i}_x`) * SCALE,
                    top: n(`card${i}_y`) * SCALE,
                    width: pw * SCALE,
                    height: ph * SCALE,
                    backgroundColor: i === 1 ? '#e0f2f1' : '#e3f2fd',
                    borderWidth: 1.5,
                    borderColor: i === 1 ? '#00796b' : '#1565c0',
                    borderStyle: 'dashed',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  testID={`preview-card-${i}`}
                >
                  <Text style={{ fontSize: 11, fontWeight: '800', color: i === 1 ? '#00796b' : '#1565c0' }}>بطاقة {i}</Text>
                  <Text style={{ fontSize: 9, color: '#8a95a8' }}>{n(`card${i}_x`)}, {n(`card${i}_y`)} مم</Text>
                </View>
              ))}
            </View>
            <Text style={{ fontSize: 10.5, color: '#8a95a8', textAlign: 'center', marginTop: 6 }}>
              جرّب طباعة ورقة واحدة أولاً ثم عدّل الإزاحات حسب طابعتك
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f6fb' },
  row: { flexDirection: 'row-reverse', gap: 14, flexWrap: 'wrap', justifyContent: 'center' },
  panel: { backgroundColor: '#fff', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#e6eaf2', width: 380, maxWidth: '100%' },
  title: { fontSize: 16, fontWeight: '800', color: '#1a2540', textAlign: 'right', marginBottom: 4 },
  hint: { fontSize: 11.5, color: '#5b6678', textAlign: 'right', lineHeight: 18, marginBottom: 12 },
  label: { fontSize: 11.5, fontWeight: '700', color: '#1a2540', textAlign: 'right', marginBottom: 4, marginTop: 8 },
  pickerWrap: { borderWidth: 1, borderColor: '#dde3ec', borderRadius: 8, backgroundColor: '#fbfcfe', overflow: 'hidden' },
  input: { borderWidth: 1, borderColor: '#dde3ec', borderRadius: 8, padding: 9, textAlign: 'center', fontSize: 13, backgroundColor: '#fbfcfe', color: '#1a2540' },
  fieldsRow: { flexDirection: 'row-reverse', gap: 8 },
  sectionTitle: { fontSize: 12.5, fontWeight: '800', color: '#00796b', textAlign: 'right', marginTop: 14, marginBottom: 4, borderBottomWidth: 1, borderBottomColor: '#e0f2f1', paddingBottom: 4 },
  countBox: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, backgroundColor: '#e8f5e9', borderRadius: 8, padding: 9, marginTop: 12 },
  countText: { fontSize: 12.5, fontWeight: '800', color: '#2e7d32' },
  msg: { marginTop: 10, fontSize: 12, fontWeight: '700', color: '#2e7d32', textAlign: 'right' },
  dlBtn: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#00796b', borderRadius: 10, padding: 13, marginTop: 14 },
  dlBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  a4: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#cfd6e1', alignSelf: 'center', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, position: 'relative' },
});
