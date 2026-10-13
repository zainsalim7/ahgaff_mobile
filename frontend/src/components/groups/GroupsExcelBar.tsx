import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Platform, Alert, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { courseGroupsAPI } from '../../services/api';
import { downloadBlob, filenameFromResponse } from '../../utils/exportName';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const notify = (t: string, m: string) => (Platform.OS === 'web' ? window.alert(`${t}\n${m}`) : Alert.alert(t, m));
const confirm = (m: string) => (Platform.OS === 'web' ? Promise.resolve(window.confirm(m)) : new Promise<boolean>((r) => Alert.alert('تأكيد', m, [{ text: 'إلغاء', onPress: () => r(false) }, { text: 'تطبيق', onPress: () => r(true) }])));

const saveXlsx = async (p: Promise<any>, fallback: string) => {
  const r = await p;
  downloadBlob(r.data, filenameFromResponse(r, `${fallback}.xlsx`), XLSX);
};

type Props = { courseId: string; group?: string; course?: { department_id?: string; level?: number; section?: string; name?: string }; compact?: boolean; onImported?: () => void };

/** 📤📥 تصدير/استيراد توزيع المجموعات (Excel) — يُستخدم في صفحة المجموعة ونافذة المجموعات */
export const GroupsExcelBar: React.FC<Props> = ({ courseId, group, course, compact, onImported }) => {
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [file, setFile] = useState<{ fd: FormData } | null>(null);
  const [createMissing, setCreateMissing] = useState(false);

  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); try { await fn(); } catch (e: any) { notify('خطأ', e?.response?.data?.detail || 'فشلت العملية'); } finally { setBusy(null); } };

  const pickAndPreview = () => run('import', async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: [XLSX, 'application/vnd.ms-excel'], copyToCacheDirectory: true });
    if (r.canceled) return;
    const a: any = r.assets[0];
    const fd = new FormData();
    fd.append('file', (Platform.OS === 'web' && a.file ? a.file : { uri: a.uri, name: a.name, type: a.mimeType || XLSX }) as any);
    const p = await courseGroupsAPI.importPreview(courseId, fd);
    setPreview(p.data); setFile({ fd }); setCreateMissing(false);
  });

  const apply = () => run('apply', async () => {
    if (!file || !preview) return;
    if (!(await confirm(`سيُطبَّق ${preview.changes} تغيير على توزيع المجموعات. متابعة؟`))) return;
    const r = await courseGroupsAPI.importApply(courseId, file.fd, createMissing);
    notify('تم', r.data.message); setPreview(null); setFile(null); onImported?.();
  });

  const Btn = ({ k, icon, label, onPress, color = '#1565c0' }: any) => (
    <TouchableOpacity onPress={onPress} disabled={!!busy} style={[s.btn, { borderColor: color }, compact && s.btnCompact]} testID={`groups-excel-${k}`}>
      {busy === k ? <ActivityIndicator size="small" color={color} /> : <Ionicons name={icon} size={14} color={color} />}
      <Text style={[s.btnTxt, { color }]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View testID="groups-excel-bar">
      <View style={s.row}>
        <Btn k="export" icon="download-outline" label={group ? 'تصدير المجموعة' : 'تصدير كل المجموعات'} onPress={() => run('export', () => saveXlsx(courseGroupsAPI.export(courseId, group), 'groups'))} />
        {!!group && <Btn k="export-all" icon="albums-outline" label="تصدير كل المجموعات" onPress={() => run('export-all', () => saveXlsx(courseGroupsAPI.export(courseId), 'groups'))} />}
        {!!course?.department_id && !!course?.level && (
          <Btn k="export-level" icon="layers-outline" label={`تصدير المستوى ${course.level} كاملاً`} color="#6a1b9a"
            onPress={() => run('export-level', () => saveXlsx(courseGroupsAPI.exportLevel({ department_id: course.department_id!, level: course.level!, section: course.section || undefined }), 'level-groups'))} />
        )}
        <Btn k="template" icon="document-text-outline" label="قالب الاستيراد" color="#00838f" onPress={() => run('template', () => saveXlsx(courseGroupsAPI.importTemplate(courseId), 'template'))} />
        <Btn k="import" icon="cloud-upload-outline" label="استيراد توزيع (Excel)" color="#2e7d32" onPress={pickAndPreview} />
      </View>
      {preview && (
        <View style={s.preview} testID="groups-import-preview">
          <Text style={s.pTitle}>معاينة الاستيراد — {preview.total_rows} صف</Text>
          <Text style={s.pLine}>✅ تغييرات ستُطبَّق: <Text style={s.b}>{preview.changes}</Text> · بلا تغيير: {preview.unchanged}</Text>
          {preview.unknown_students?.length > 0 && <Text style={[s.pLine, { color: '#c62828' }]}>⚠️ أرقام قيد غير مسجلة في المقرر (ستُتجاهل): {preview.unknown_students.slice(0, 8).map((u: any) => u.student_number).join('، ')}{preview.unknown_students.length > 8 ? ` +${preview.unknown_students.length - 8}` : ''}</Text>}
          {preview.undefined_groups?.length > 0 && (
            <TouchableOpacity onPress={() => setCreateMissing(!createMissing)} style={s.chk} testID="groups-import-create-missing">
              <Ionicons name={createMissing ? 'checkbox' : 'square-outline'} size={18} color="#ef6c00" />
              <Text style={[s.pLine, { color: '#ef6c00', flex: 1 }]}>مجموعات غير معرّفة في المقرر: {preview.undefined_groups.map((u: any) => `${u.label} (${u.count})`).join('، ')} — إنشاؤها تلقائياً</Text>
            </TouchableOpacity>
          )}
          <View style={s.row}>
            <TouchableOpacity onPress={apply} disabled={!!busy || (preview.undefined_groups?.length > 0 && !createMissing) || !preview.changes} style={[s.apply, ((preview.undefined_groups?.length > 0 && !createMissing) || !preview.changes) && { opacity: 0.5 }]} testID="groups-import-apply">
              <Text style={s.applyTxt}>{busy === 'apply' ? 'جاري التطبيق…' : `تطبيق ${preview.changes} تغيير`}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setPreview(null); setFile(null); }} style={[s.btn, { borderColor: '#9e9e9e' }]} testID="groups-import-cancel"><Text style={[s.btnTxt, { color: '#5b6678' }]}>إلغاء</Text></TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
};

const s = StyleSheet.create({
  row: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  btn: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: '#fff' },
  btnCompact: { paddingHorizontal: 8, paddingVertical: 5 },
  btnTxt: { fontSize: 12, fontWeight: '700' },
  preview: { marginTop: 8, backgroundColor: '#f8fafc', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#e2e8f0', gap: 6 },
  pTitle: { fontSize: 13, fontWeight: '800', color: '#1a2540', textAlign: 'right' },
  pLine: { fontSize: 12, color: '#334155', textAlign: 'right' },
  b: { fontWeight: '800' },
  chk: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  apply: { backgroundColor: '#2e7d32', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  applyTxt: { color: '#fff', fontWeight: '800', fontSize: 12.5 },
});
