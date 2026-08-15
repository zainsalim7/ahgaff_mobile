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
  signatory_title: 'مسجل الكلية',
  signature_base64: '',
  phones: '',
  fax: '',
  po_box: '',
  website: 'www.AHGAFF.EDU',
  address: 'الجمهورية اليمنية – تريم – حضرموت',
  faculty_name_en: '',
  logo_base64: '',
  reference_format: '',
};

const Field = ({ label, value, onChange, placeholder, ltr, testID }: any) => (
  <View style={styles.fieldWrap}>
    <Text style={styles.label}>{label}</Text>
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor="#9aa4b2"
      style={[styles.input, ltr && { textAlign: 'left', direction: 'ltr' as any }]}
      testID={testID}
    />
  </View>
);

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
  const [templates, setTemplates] = useState<any[]>([]);
  const [tplName, setTplName] = useState('');
  const [tplBody, setTplBody] = useState('');
  const [editingTplId, setEditingTplId] = useState('');
  const [tplMsg, setTplMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [savingTpl, setSavingTpl] = useState(false);

  const TPL_VARS = ['{اسم_الطالب}', '{رقم_القيد}', '{الجنسية}', '{المستوى}', '{التخصص}', '{الكلية}', '{العام_الجامعي}', '{الحالة}', '{التاريخ}', '{الفصل}', '{المعدل}', '{التقدير}'];

  const loadTemplates = useCallback(async () => {
    try {
      const res = await api.get('/statement-templates');
      setTemplates(res.data || []);
    } catch {}
  }, []);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  const saveTemplate = async () => {
    if (!tplName.trim() || !tplBody.trim()) {
      setTplMsg({ type: 'err', text: 'اسم القالب ومتنه مطلوبان' });
      return;
    }
    setSavingTpl(true);
    setTplMsg(null);
    try {
      if (editingTplId) {
        await api.put(`/statement-templates/${editingTplId}`, { name: tplName.trim(), body: tplBody.trim() });
        setTplMsg({ type: 'ok', text: '✅ تم تحديث القالب' });
      } else {
        await api.post('/statement-templates', { name: tplName.trim(), body: tplBody.trim() });
        setTplMsg({ type: 'ok', text: '✅ تم إنشاء القالب — سيظهر عند إصدار أي إفادة' });
      }
      setTplName(''); setTplBody(''); setEditingTplId('');
      loadTemplates();
    } catch (e: any) {
      setTplMsg({ type: 'err', text: e?.response?.data?.detail || 'فشل حفظ القالب' });
    } finally {
      setSavingTpl(false);
    }
  };

  const deleteTemplate = async (t: any) => {
    if (Platform.OS === 'web' && !window.confirm(`حذف القالب «${t.name}»؟ لن يؤثر على الإفادات الصادرة سابقاً.`)) return;
    try {
      await api.delete(`/statement-templates/${t.id}`);
      if (editingTplId === t.id) { setTplName(''); setTplBody(''); setEditingTplId(''); }
      setTplMsg({ type: 'ok', text: '✅ تم حذف القالب' });
      loadTemplates();
    } catch (e: any) {
      setTplMsg({ type: 'err', text: e?.response?.data?.detail || 'فشل حذف القالب' });
    }
  };

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

  const pickImage = (field: 'logo_base64' | 'signature_base64', label: string) => {
    if (Platform.OS !== 'web') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        setMsg({ type: 'err', text: `حجم ${label} يتجاوز 2MB — الرجاء اختيار صورة أصغر` });
        return;
      }
      const reader = new FileReader();
      reader.onload = () => setForm((p) => ({ ...p, [field]: String(reader.result || '') }));
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const pickLogo = () => pickImage('logo_base64', 'الشعار');

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

          {/* صورة التوقيع/الختم */}
          <Text style={[styles.sectionTitle, { marginTop: 14 }]}>صورة التوقيع / ختم الكلية (تظهر فوق اسم الموقّع)</Text>
          <View style={styles.logoRow}>
            <TouchableOpacity onPress={() => pickImage('signature_base64', 'صورة التوقيع')} style={styles.uploadBtn} testID="statement-signature-upload-btn">
              <Ionicons name="cloud-upload-outline" size={16} color="#00796b" />
              <Text style={styles.uploadBtnText}>{form.signature_base64 ? 'تغيير الصورة' : 'رفع صورة توقيع/ختم'}</Text>
            </TouchableOpacity>
            {!!form.signature_base64 && (
              <TouchableOpacity
                onPress={() => setForm((p) => ({ ...p, signature_base64: '' }))}
                style={styles.removeBtn}
                testID="statement-signature-remove-btn"
              >
                <Ionicons name="trash-outline" size={15} color="#c62828" />
                <Text style={styles.removeBtnText}>إزالة</Text>
              </TouchableOpacity>
            )}
            {form.signature_base64 ? (
              <Image source={{ uri: form.signature_base64 }} style={styles.logoPreview} resizeMode="contain" />
            ) : (
              <View style={styles.logoPlaceholder}>
                <Text style={styles.logoPlaceholderText}>بدون صورة — يظهر الاسم فقط</Text>
              </View>
            )}
          </View>
          <Text style={{ fontSize: 11, color: '#8a94a6', textAlign: 'right', marginBottom: 10, lineHeight: 18 }}>
            💡 يُفضل صورة PNG بخلفية شفافة ليظهر التوقيع نظيفاً فوق الورقة
          </Text>

          {/* المسجل والترويسة */}
          <Text style={styles.sectionTitle}>بيانات الكليشة</Text>
          <Field
            label="صفة الموقّع الافتراضية (مثل: مسجل الكلية أو عميد الكلية)"
            value={form.signatory_title}
            onChange={(t: string) => setForm((p) => ({ ...p, signatory_title: t }))}
            placeholder="مسجل الكلية"
          />
          <Field
            label="اسم الموقّع الافتراضي (يظهر تحت التوقيع)"
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
          <Field
            label="صيغة رقم المرجع — {seq} = الرقم التسلسلي، {year} = السنة، {yy} = آخر رقمين"
            value={form.reference_format}
            onChange={(t: string) => setForm((p) => ({ ...p, reference_format: t }))}
            placeholder="اتركه فارغاً للصيغة الأساسية: {seq} /7/2/ت ك ش ق /27/26"
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

        {/* قوالب الإفادات — مشتركة لكل الكليات */}
        <View style={[styles.card, { marginTop: 14 }]} testID="statement-templates-card">
          <Text style={styles.title}>📋 قوالب الإفادات (مشتركة لكل الكليات)</Text>
          <Text style={styles.hint}>
            أنشئ قوالب جاهزة بمتغيرات تُستبدل تلقائياً ببيانات الطالب عند الإصدار. القوالب متاحة عند إصدار أي إفادة من صفحة الطالب.
          </Text>

          {templates.length === 0 ? (
            <View style={styles.logoPlaceholder}>
              <Text style={styles.logoPlaceholderText}>لا توجد قوالب بعد — أنشئ أول قالب أدناه</Text>
            </View>
          ) : templates.map((t) => (
            <View key={t.id} style={styles.tplRow} testID={`template-row-${t.id}`}>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <TouchableOpacity
                  onPress={() => { setEditingTplId(t.id); setTplName(t.name); setTplBody(t.body); setTplMsg(null); }}
                  style={styles.tplActionBtn}
                  testID={`template-edit-btn-${t.id}`}
                >
                  <Ionicons name="create-outline" size={15} color="#1565c0" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => deleteTemplate(t)} style={styles.tplActionBtn} testID={`template-delete-btn-${t.id}`}>
                  <Ionicons name="trash-outline" size={15} color="#c62828" />
                </TouchableOpacity>
              </View>
              <View style={{ flex: 1, marginRight: 8 }}>
                <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
                  <Text style={styles.tplName}>{t.name}</Text>
                  {!!t.builtin && (
                    <View style={{ backgroundColor: '#e0f2f1', borderRadius: 10, paddingVertical: 1, paddingHorizontal: 8 }}>
                      <Text style={{ fontSize: 10, fontWeight: '800', color: '#00796b' }}>ثابت</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.tplBodyPreview} numberOfLines={2}>{t.body}</Text>
              </View>
            </View>
          ))}

          <Text style={[styles.sectionTitle, { marginTop: 14 }]}>{editingTplId ? '✏️ تعديل القالب' : '➕ قالب جديد'}</Text>
          <Field
            label="اسم القالب (مثال: إفادة تقديم للسفارة)"
            value={tplName}
            onChange={setTplName}
            placeholder="اسم القالب"
            testID="template-name-input"
          />
          <Text style={styles.label}>متن القالب</Text>
          <TextInput
            value={tplBody}
            onChangeText={setTplBody}
            multiline
            placeholder={'مثال: {الجنسية} الجنسية، يدرس بالمستوى {المستوى} تخصص ({التخصص}) للعام الجامعي {العام_الجامعي}، ويحمل رقم قيد ({رقم_القيد}) وهو {الحالة}.'}
            placeholderTextColor="#9aa4b2"
            style={[styles.input, { minHeight: 100, textAlignVertical: 'top' as any, marginBottom: 8 }]}
            testID="template-body-input"
          />
          <Text style={styles.label}>المتغيرات المتاحة — اضغط لإدراجها في المتن:</Text>
          <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, marginTop: 4, marginBottom: 6 }}>
            {TPL_VARS.map((v) => (
              <TouchableOpacity key={v} onPress={() => setTplBody((p) => (p ? `${p} ${v}` : v))} style={styles.varChip} testID={`var-chip-${v}`}>
                <Text style={styles.varChipText}>{v}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={{ fontSize: 11, color: '#8a94a6', textAlign: 'right', lineHeight: 18 }}>
            💡 يُطبع المتن في الـ PDF بعد سطر «بأن الطالب: الاسم» مع نفس الترويسة والتوقيع ورمز QR
          </Text>

          {tplMsg && (
            <View style={[styles.msgBox, tplMsg.type === 'ok' ? styles.msgOk : styles.msgErr]} testID="template-msg">
              <Text style={[styles.msgText, { color: tplMsg.type === 'ok' ? '#2e7d32' : '#c62828' }]}>{tplMsg.text}</Text>
            </View>
          )}

          <View style={{ flexDirection: 'row-reverse', gap: 8 }}>
            <TouchableOpacity
              onPress={saveTemplate}
              disabled={savingTpl}
              style={[styles.saveBtn, { flex: 1 }, savingTpl && { opacity: 0.6 }]}
              testID="template-save-btn"
            >
              {savingTpl ? <ActivityIndicator size="small" color="#fff" /> : (
                <Text style={styles.saveBtnText}>{editingTplId ? 'حفظ التعديل' : 'إنشاء القالب'}</Text>
              )}
            </TouchableOpacity>
            {!!editingTplId && (
              <TouchableOpacity
                onPress={() => { setEditingTplId(''); setTplName(''); setTplBody(''); setTplMsg(null); }}
                style={[styles.saveBtn, { backgroundColor: '#90a4ae', flex: 0.5 }]}
                testID="template-cancel-edit-btn"
              >
                <Text style={styles.saveBtnText}>إلغاء التعديل</Text>
              </TouchableOpacity>
            )}
          </View>
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
  tplRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: '#e6eaf2', borderRadius: 10, padding: 10, marginBottom: 8, backgroundColor: '#fbfcfe',
  },
  tplName: { fontSize: 13, fontWeight: '800', color: '#1a2540', textAlign: 'right' },
  tplBodyPreview: { fontSize: 11, color: '#7b8794', textAlign: 'right', marginTop: 2, lineHeight: 16 },
  tplActionBtn: { padding: 6, borderRadius: 6, borderWidth: 1, borderColor: '#e6eaf2', backgroundColor: '#fff' },
  varChip: { backgroundColor: '#ede7f6', borderRadius: 14, paddingVertical: 4, paddingHorizontal: 10 },
  varChipText: { fontSize: 11, fontWeight: '700', color: '#5e35b1' },
});
