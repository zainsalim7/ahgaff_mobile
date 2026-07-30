import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView,
  Platform, ActivityIndicator, Image, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Picker } from '@react-native-picker/picker';
import api from '../src/services/api';
import { useAuth } from '../src/contexts/AuthContext';

interface Faculty { id: string; name: string; }

const EMPTY = {
  registrar_name: '',
  phones: '',
  fax: '',
  po_box: '',
  website: 'www.AHGAFF.EDU',
  address: 'الجمهورية اليمنية – تريم – حضرموت',
  faculty_name_en: '',
  logo_base64: '',
};

export default function StatementSettingsScreen() {
  const params = useLocalSearchParams<{ facultyId?: string }>();
  const { user } = useAuth();
  const [faculties, setFaculties] = useState<Faculty[]>([]);
  const [facultyId, setFacultyId] = useState<string>((params.facultyId as string) || '');
  const [form, setForm] = useState({ ...EMPTY });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [verifyBase, setVerifyBase] = useState('');
  const [savingBase, setSavingBase] = useState(false);
  const [baseMsg, setBaseMsg] = useState('');

  useEffect(() => {
    if (user?.role !== 'admin') return;
    api.get('/settings/verify-base-url').then((r) => setVerifyBase(r.data?.value || '')).catch(() => {});
  }, [user?.role]);

  const saveVerifyBase = async () => {
    setSavingBase(true);
    setBaseMsg('');
    try {
      const res = await api.put('/settings/verify-base-url', { value: verifyBase.trim() });
      setBaseMsg(res.data?.message || 'تم الحفظ');
    } catch (e: any) {
      setBaseMsg(e?.response?.data?.detail || 'فشل الحفظ');
    } finally {
      setSavingBase(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/faculties');
        const list = (res.data || []).map((f: any) => ({ id: f.id || f._id, name: f.name }));
        setFaculties(list);
        if (!facultyId && list.length > 0) setFacultyId(list[0].id);
      } catch {
        setMsg({ type: 'err', text: 'فشل جلب قائمة الكليات' });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const loadSettings = useCallback(async (fid: string) => {
    if (!fid) return;
    setMsg(null);
    try {
      const res = await api.get(`/statements/settings/${fid}`);
      setForm({ ...EMPTY, ...(res.data || {}) });
    } catch {
      setForm({ ...EMPTY });
    }
  }, []);

  useEffect(() => { loadSettings(facultyId); }, [facultyId, loadSettings]);

  const pickLogo = () => {
    if (Platform.OS !== 'web') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        setMsg({ type: 'err', text: 'حجم الشعار يتجاوز 2MB — الرجاء اختيار صورة أصغر' });
        return;
      }
      const reader = new FileReader();
      reader.onload = () => setForm((p) => ({ ...p, logo_base64: String(reader.result || '') }));
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const save = async () => {
    if (!facultyId) return;
    setSaving(true);
    setMsg(null);
    try {
      await api.put(`/statements/settings/${facultyId}`, form);
      setMsg({ type: 'ok', text: '✅ تم حفظ إعدادات الكليشة بنجاح — ستظهر على الإفادات الجديدة' });
    } catch (e: any) {
      setMsg({ type: 'err', text: e.response?.data?.detail || 'فشل الحفظ' });
    } finally {
      setSaving(false);
    }
  };

  const Field = ({ label, value, onChange, placeholder, ltr }: any) => (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#9aa4b2"
        style={[styles.input, ltr && { textAlign: 'left', direction: 'ltr' as any }]}
      />
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color="#00796b" style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <View style={styles.card}>
          <Text style={styles.title}>🖨️ كليشة الإفادة الرسمية</Text>
          <Text style={styles.hint}>
            حدد الكلية ثم عدّل بيانات الترويسة والتذييل واسم المسجل — تُطبق هذه الإعدادات على كل إفادة تصدر من هذه الكلية.
          </Text>

          <Text style={styles.label}>الكلية</Text>
          <View style={styles.pickerWrap}>
            <Picker
              selectedValue={facultyId}
              onValueChange={(v) => setFacultyId(String(v))}
              style={styles.picker}
              testID="statement-settings-faculty-picker"
            >
              {faculties.map((f) => (
                <Picker.Item key={f.id} label={f.name} value={f.id} />
              ))}
            </Picker>
          </View>

          {/* الشعار */}
          <Text style={[styles.sectionTitle, { marginTop: 14 }]}>شعار الكلية على الإفادة</Text>
          <View style={styles.logoRow}>
            <TouchableOpacity onPress={pickLogo} style={styles.uploadBtn} testID="statement-logo-upload-btn">
              <Ionicons name="cloud-upload-outline" size={16} color="#00796b" />
              <Text style={styles.uploadBtnText}>{form.logo_base64 ? 'تغيير الشعار' : 'رفع شعار مخصص'}</Text>
            </TouchableOpacity>
            {!!form.logo_base64 && (
              <TouchableOpacity
                onPress={() => setForm((p) => ({ ...p, logo_base64: '' }))}
                style={styles.removeBtn}
                testID="statement-logo-remove-btn"
              >
                <Ionicons name="trash-outline" size={15} color="#c62828" />
                <Text style={styles.removeBtnText}>إزالة</Text>
              </TouchableOpacity>
            )}
            {form.logo_base64 ? (
              <Image source={{ uri: form.logo_base64 }} style={styles.logoPreview} resizeMode="contain" />
            ) : (
              <View style={styles.logoPlaceholder}>
                <Text style={styles.logoPlaceholderText}>سيُستخدم شعار الجامعة الافتراضي</Text>
              </View>
            )}
          </View>

          {/* المسجل والترويسة */}
          <Text style={styles.sectionTitle}>بيانات الكليشة</Text>
          <Field
            label="اسم مسجل الكلية (يظهر تحت التوقيع)"
            value={form.registrar_name}
            onChange={(t: string) => setForm((p) => ({ ...p, registrar_name: t }))}
            placeholder="مثال: أ. محمد سالم بن يحيى"
          />
          <Field
            label="اسم الكلية بالإنجليزية (للترويسة)"
            value={form.faculty_name_en}
            onChange={(t: string) => setForm((p) => ({ ...p, faculty_name_en: t }))}
            placeholder="Faculty of Shariah & Law"
            ltr
          />

          {/* التذييل */}
          <Text style={styles.sectionTitle}>بيانات التذييل (أسفل الورقة)</Text>
          <Field
            label="العنوان"
            value={form.address}
            onChange={(t: string) => setForm((p) => ({ ...p, address: t }))}
            placeholder="الجمهورية اليمنية – تريم – حضرموت"
          />
          <Field
            label="أرقام الهاتف"
            value={form.phones}
            onChange={(t: string) => setForm((p) => ({ ...p, phones: t }))}
            placeholder="417506 - 417507"
          />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Field
                label="الفاكس"
                value={form.fax}
                onChange={(t: string) => setForm((p) => ({ ...p, fax: t }))}
                placeholder="417508"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="صندوق البريد (ص.ب)"
                value={form.po_box}
                onChange={(t: string) => setForm((p) => ({ ...p, po_box: t }))}
                placeholder="50511"
              />
            </View>
          </View>
          <Field
            label="الموقع الإلكتروني"
            value={form.website}
            onChange={(t: string) => setForm((p) => ({ ...p, website: t }))}
            placeholder="www.AHGAFF.EDU"
            ltr
          />

          {msg && (
            <View style={[styles.msgBox, msg.type === 'ok' ? styles.msgOk : styles.msgErr]} testID="statement-settings-msg">
              <Text style={[styles.msgText, { color: msg.type === 'ok' ? '#2e7d32' : '#c62828' }]}>{msg.text}</Text>
            </View>
          )}

          <TouchableOpacity
            onPress={save}
            disabled={saving || !facultyId}
            style={[styles.saveBtn, (saving || !facultyId) && { opacity: 0.6 }]}
            testID="statement-settings-save-btn"
          >
            {saving ? <ActivityIndicator size="small" color="#fff" /> : (
              <>
                <Ionicons name="save-outline" size={17} color="#fff" />
                <Text style={styles.saveBtnText}>حفظ إعدادات الكليشة</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* رابط التحقق الأساسي — أدمن فقط */}
        {user?.role === 'admin' && (
          <View style={[styles.card, { marginTop: 14 }]}>
            <Text style={styles.title}>🔗 رابط التحقق الأساسي (لكل النظام)</Text>
            <Text style={styles.hint}>
              رموز QR الجديدة (الإفادات والبطاقات) ستُولَّد على هذا الرابط بدل رابط النظام. مثال: https://ahgaff.net — اتركه فارغاً لاستخدام رابط النظام الحالي.
            </Text>
            <TextInput
              value={verifyBase}
              onChangeText={setVerifyBase}
              placeholder="https://ahgaff.net"
              placeholderTextColor="#9aa4b2"
              style={[styles.input, { textAlign: 'left', direction: 'ltr' as any }]}
              testID="verify-base-url-input"
            />
            {!!baseMsg && <Text style={[styles.msgText, { color: baseMsg.includes('فشل') ? '#c62828' : '#2e7d32', marginTop: 8 }]} testID="verify-base-msg">{baseMsg}</Text>}
            <TouchableOpacity
              onPress={saveVerifyBase}
              disabled={savingBase}
              style={[styles.saveBtn, savingBase && { opacity: 0.6 }]}
              testID="verify-base-save-btn"
            >
              {savingBase ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveBtnText}>حفظ رابط التحقق</Text>}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f6fb' },
  card: {
    backgroundColor: '#fff', borderRadius: 14, padding: 18, maxWidth: 640,
    width: '100%', alignSelf: 'center', borderWidth: 1, borderColor: '#e6eaf2',
  },
  title: { fontSize: 17, fontWeight: '800', color: '#1a2540', textAlign: 'right', marginBottom: 6 },
  hint: { fontSize: 12, color: '#5b6678', textAlign: 'right', lineHeight: 20, marginBottom: 14 },
  sectionTitle: {
    fontSize: 13.5, fontWeight: '800', color: '#00796b', textAlign: 'right',
    marginTop: 10, marginBottom: 8, borderBottomWidth: 1, borderBottomColor: '#e0f2f1', paddingBottom: 5,
  },
  label: { fontSize: 12, fontWeight: '700', color: '#1a2540', textAlign: 'right', marginBottom: 4 },
  fieldWrap: { marginBottom: 10 },
  input: {
    borderWidth: 1, borderColor: '#dde3ec', borderRadius: 8, padding: 10,
    textAlign: 'right', fontSize: 13, backgroundColor: '#fbfcfe', color: '#1a2540',
  },
  pickerWrap: { borderWidth: 1, borderColor: '#dde3ec', borderRadius: 8, backgroundColor: '#fbfcfe', overflow: 'hidden' },
  picker: { height: 42, width: '100%' },
  logoRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' },
  uploadBtn: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 6, borderWidth: 1,
    borderColor: '#00796b', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12,
  },
  uploadBtnText: { color: '#00796b', fontWeight: '700', fontSize: 12.5 },
  removeBtn: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: 8 },
  removeBtnText: { color: '#c62828', fontWeight: '700', fontSize: 12 },
  logoPreview: { width: 64, height: 64, borderRadius: 8, borderWidth: 1, borderColor: '#e6eaf2', backgroundColor: '#fff' },
  logoPlaceholder: {
    height: 44, justifyContent: 'center', paddingHorizontal: 10,
    backgroundColor: '#f0f4f8', borderRadius: 8, borderWidth: 1, borderColor: '#e6eaf2', borderStyle: 'dashed',
  },
  logoPlaceholderText: { fontSize: 11, color: '#7b8794' },
  msgBox: { borderRadius: 8, padding: 10, marginTop: 12 },
  msgOk: { backgroundColor: '#e8f5e9' },
  msgErr: { backgroundColor: '#ffebee' },
  msgText: { fontSize: 12.5, fontWeight: '700', textAlign: 'right' },
  saveBtn: {
    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#00796b', borderRadius: 10, padding: 13, marginTop: 14,
  },
  saveBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
