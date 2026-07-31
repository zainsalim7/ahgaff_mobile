import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Picker } from '@react-native-picker/picker';
import api from '../src/services/api';

const TEMPLATES = [
  { key: 'green', name: 'الرسمي الأخضر', desc: 'ألوان الجامعة — بطاقة عمودية تقليدية', colors: ['#1b5e20', '#fff', '#e8f5e9'] },
  { key: 'official', name: 'الرسمي الأنيق', desc: 'أخضر وأبيض بشريط جانبي وزخارف خفيفة — بطاقة عمودية', colors: ['#1b5e20', '#e8f5e9', '#fff'] },
  { key: 'dark', name: 'العصري الداكن', desc: 'خلفية داكنة أنيقة — بطاقة عمودية', colors: ['#071417', '#0f2027', '#4db6ac'] },
  { key: 'horizontal', name: 'الأفقي المدمج', desc: 'كبطاقة الهوية — الصورة يميناً والبيانات يساراً', colors: ['#1b5e20', '#fff', '#e8f5e9'] },
];

export default function CardSettingsScreen() {
  const params = useLocalSearchParams<{ facultyId?: string }>();
  const [faculties, setFaculties] = useState<{ id: string; name: string }[]>([]);
  const [facultyId, setFacultyId] = useState<string>((params.facultyId as string) || '');
  const [template, setTemplate] = useState('green');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/faculties');
        const list = (res.data || []).map((f: any) => ({ id: f.id || f._id, name: f.name }));
        setFaculties(list);
        if (!facultyId && list.length > 0) setFacultyId(list[0].id);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!facultyId) return;
    api.get(`/cards/settings/${facultyId}`).then((r) => setTemplate(r.data?.template || 'green')).catch(() => setTemplate('green'));
  }, [facultyId]);

  const save = async () => {
    setSaving(true);
    setMsg('');
    try {
      await api.put(`/cards/settings/${facultyId}`, { template });
      setMsg('✅ تم حفظ تصميم البطاقة — يسري على كل بطاقات هذه الكلية');
    } catch (e: any) {
      setMsg(e?.response?.data?.detail || 'فشل الحفظ');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <SafeAreaView style={styles.container}><ActivityIndicator size="large" color="#00796b" style={{ marginTop: 60 }} /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <View style={styles.cardBox}>
          <Text style={styles.title}>🎨 تصميم البطاقة الرقمية</Text>
          <Text style={styles.hint}>اختر القالب المعتمد لبطاقات طلاب كل كلية — يمكن تغييره في أي وقت.</Text>

          <Text style={styles.label}>الكلية</Text>
          <View style={styles.pickerWrap}>
            <Picker selectedValue={facultyId} onValueChange={(v) => setFacultyId(String(v))} style={{ height: 42 }} testID="card-settings-faculty-picker">
              {faculties.map((f) => <Picker.Item key={f.id} label={f.name} value={f.id} />)}
            </Picker>
          </View>

          <View style={{ marginTop: 16, gap: 10 }}>
            {TEMPLATES.map((tp) => (
              <TouchableOpacity
                key={tp.key}
                onPress={() => setTemplate(tp.key)}
                style={[styles.templateRow, template === tp.key && styles.templateActive]}
                data-testid={`template-option-${tp.key}`}
              >
                <View style={{ flexDirection: 'row', gap: 3 }}>
                  {tp.colors.map((c, i) => <View key={i} style={{ width: 18, height: 34, borderRadius: 4, backgroundColor: c, borderWidth: 1, borderColor: '#e0e0e0' }} />)}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.templateName}>{tp.name}</Text>
                  <Text style={styles.templateDesc}>{tp.desc}</Text>
                </View>
                <Ionicons name={template === tp.key ? 'radio-button-on' : 'radio-button-off'} size={20} color={template === tp.key ? '#00796b' : '#b0bec5'} />
              </TouchableOpacity>
            ))}
          </View>

          {!!msg && <Text style={styles.msg} data-testid="card-settings-msg">{msg}</Text>}

          <TouchableOpacity onPress={save} disabled={saving || !facultyId} style={[styles.saveBtn, (saving || !facultyId) && { opacity: 0.6 }]} data-testid="card-settings-save-btn">
            {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveBtnText}>حفظ التصميم</Text>}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f6fb' },
  cardBox: { backgroundColor: '#fff', borderRadius: 14, padding: 18, maxWidth: 560, width: '100%', alignSelf: 'center', borderWidth: 1, borderColor: '#e6eaf2' },
  title: { fontSize: 16, fontWeight: '800', color: '#1a2540', textAlign: 'right', marginBottom: 6 },
  hint: { fontSize: 12, color: '#5b6678', textAlign: 'right', marginBottom: 14, lineHeight: 19 },
  label: { fontSize: 12, fontWeight: '700', color: '#1a2540', textAlign: 'right', marginBottom: 4 },
  pickerWrap: { borderWidth: 1, borderColor: '#dde3ec', borderRadius: 8, backgroundColor: '#fbfcfe', overflow: 'hidden' },
  templateRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12, borderWidth: 1.5, borderColor: '#e6eaf2', borderRadius: 10, padding: 12 },
  templateActive: { borderColor: '#00796b', backgroundColor: '#f1f8f6' },
  templateName: { fontSize: 13.5, fontWeight: '800', color: '#1a2540', textAlign: 'right' },
  templateDesc: { fontSize: 11.5, color: '#5b6678', textAlign: 'right', marginTop: 2 },
  msg: { marginTop: 12, fontSize: 12.5, fontWeight: '700', color: '#2e7d32', textAlign: 'right' },
  saveBtn: { backgroundColor: '#00796b', borderRadius: 10, padding: 13, alignItems: 'center', marginTop: 14 },
  saveBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
