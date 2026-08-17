import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Platform } from 'react-native';
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
  { key: 'custom', name: '🖼️ قالب مخصص (ارفع تصميمك)', desc: 'ارفع صورة تصميمك وحرّك مواضع البيانات فوقها بالسحب', colors: ['#6a1b9a', '#ede7f6', '#fff'] },
];

const EL_LABELS: Record<string, string> = {
  photo: '📷 صورة الطالب',
  qr: '🔳 رمز QR',
  name: 'اسم الطالب',
  enrollment: 'رقم القيد',
  dept: 'التخصص والمستوى',
  year: 'العام الجامعي',
};

const DEFAULT_LAYOUT: Record<string, any> = {
  photo: { x: 66, y: 16, w: 26, h: 24 },
  qr: { x: 8, y: 66, w: 18 },
  name: { x: 50, y: 46, size: 34, color: '#1a2540' },
  enrollment: { x: 50, y: 55, size: 26, color: '#1a2540' },
  dept: { x: 50, y: 62, size: 24, color: '#1a2540' },
  year: { x: 50, y: 69, size: 22, color: '#455a64' },
};

export default function CardSettingsScreen() {
  const params = useLocalSearchParams<{ facultyId?: string }>();
  const [faculties, setFaculties] = useState<{ id: string; name: string }[]>([]);
  const [facultyId, setFacultyId] = useState<string>((params.facultyId as string) || '');
  const [template, setTemplate] = useState('green');
  const [customBg, setCustomBg] = useState('');
  const [layout, setLayout] = useState<Record<string, any>>(DEFAULT_LAYOUT);
  const [selectedEl, setSelectedEl] = useState('name');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const dragRef = useRef<{ key: string; startX: number; startY: number; ox: number; oy: number } | null>(null);
  const boxRef = useRef<any>(null);

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
    api.get(`/cards/settings/${facultyId}`).then((r) => {
      setTemplate(r.data?.template || 'green');
      setCustomBg(r.data?.custom_bg_base64 || '');
      setLayout({ ...DEFAULT_LAYOUT, ...(r.data?.custom_layout || {}) });
    }).catch(() => { setTemplate('green'); setCustomBg(''); setLayout(DEFAULT_LAYOUT); });
  }, [facultyId]);

  const pickImage = () => {
    if (Platform.OS !== 'web') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return;
      if (f.size > 3 * 1024 * 1024) { setMsg('❌ حجم الصورة يتجاوز 3MB — صغّرها أولاً'); return; }
      const reader = new FileReader();
      reader.onload = () => { setCustomBg(String(reader.result)); setMsg(''); };
      reader.readAsDataURL(f);
    };
    input.click();
  };

  const onMouseDown = (key: string, e: any) => {
    e.preventDefault();
    setSelectedEl(key);
    const el = layout[key] || DEFAULT_LAYOUT[key];
    dragRef.current = { key, startX: e.clientX, startY: e.clientY, ox: el.x, oy: el.y };
  };
  const onMouseMove = (e: any) => {
    const d = dragRef.current;
    if (!d || !boxRef.current) return;
    const rect = boxRef.current.getBoundingClientRect();
    const nx = Math.min(98, Math.max(0, d.ox + ((e.clientX - d.startX) / rect.width) * 100));
    const ny = Math.min(98, Math.max(0, d.oy + ((e.clientY - d.startY) / rect.height) * 100));
    setLayout((p) => ({ ...p, [d.key]: { ...p[d.key], x: Math.round(nx * 10) / 10, y: Math.round(ny * 10) / 10 } }));
  };
  const onMouseUp = () => { dragRef.current = null; };

  const adjust = (field: string, delta: number) => {
    setLayout((p) => {
      const el = { ...(p[selectedEl] || DEFAULT_LAYOUT[selectedEl]) };
      el[field] = Math.max(4, (el[field] || 10) + delta);
      return { ...p, [selectedEl]: el };
    });
  };

  const save = async () => {
    setSaving(true);
    setMsg('');
    try {
      const body: any = { template, custom_layout: layout };
      if (template === 'custom' && customBg && customBg.startsWith('data:')) body.custom_bg_base64 = customBg;
      await api.put(`/cards/settings/${facultyId}`, body);
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

  const bgSrc = customBg ? (customBg.startsWith('data:') ? customBg : `data:image/png;base64,${customBg}`) : '';
  const sel = layout[selectedEl] || DEFAULT_LAYOUT[selectedEl];
  const isBox = selectedEl === 'photo' || selectedEl === 'qr';

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
                testID={`template-option-${tp.key}`}
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

          {template === 'custom' && Platform.OS === 'web' && (
            <View style={{ marginTop: 16 }}>
              <TouchableOpacity onPress={pickImage} style={styles.uploadBtn} testID="upload-card-bg-btn">
                <Ionicons name="cloud-upload-outline" size={18} color="#6a1b9a" />
                <Text style={{ color: '#6a1b9a', fontWeight: '800', fontSize: 13 }}>{customBg ? 'تغيير صورة التصميم' : 'رفع صورة التصميم (PNG/JPG حتى 3MB)'}</Text>
              </TouchableOpacity>

              {!!bgSrc && (
                <>
                  <Text style={[styles.hint, { marginTop: 12, marginBottom: 6 }]}>🖱️ اسحب أي عنصر لتغيير موضعه فوق تصميمك — العنصر المحدد بإطار أخضر</Text>
                  <div
                    ref={boxRef}
                    onMouseMove={onMouseMove}
                    onMouseUp={onMouseUp}
                    onMouseLeave={onMouseUp}
                    data-testid="card-layout-editor"
                    style={{ position: 'relative', width: '100%', border: '2px solid #6a1b9a', borderRadius: 10, overflow: 'hidden', userSelect: 'none', direction: 'ltr' }}
                  >
                    <img src={bgSrc} style={{ width: '100%', display: 'block' }} draggable={false} />
                    {Object.keys(EL_LABELS).map((key) => {
                      const el = layout[key] || DEFAULT_LAYOUT[key];
                      const box = key === 'photo' || key === 'qr';
                      const st: any = {
                        position: 'absolute', left: `${el.x}%`, top: `${el.y}%`, cursor: 'move',
                        border: selectedEl === key ? '2px solid #00c853' : '1.5px dashed rgba(106,27,154,0.85)',
                        backgroundColor: 'rgba(255,255,255,0.55)', borderRadius: 6,
                        fontSize: 11, fontWeight: 700, color: '#4a148c', padding: '2px 6px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap',
                      };
                      if (box) { st.width = `${el.w}%`; st.height = key === 'photo' ? `${el.h}%` : undefined; if (key === 'qr') st.aspectRatio = '1'; }
                      else { st.transform = 'translateX(-50%)'; }
                      return (
                        <div key={key} onMouseDown={(e: any) => onMouseDown(key, e)} data-testid={`layout-el-${key}`} style={st}>
                          {EL_LABELS[key]}
                        </div>
                      );
                    })}
                  </div>

                  <View style={styles.adjustRow}>
                    <Text style={styles.label}>العنصر المحدد: {EL_LABELS[selectedEl]}</Text>
                    <View style={{ flexDirection: 'row-reverse', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                      {isBox ? (
                        <>
                          <Text style={styles.adjLbl}>العرض:</Text>
                          <TouchableOpacity onPress={() => adjust('w', 2)} style={styles.adjBtn}><Text style={styles.adjTxt}>+</Text></TouchableOpacity>
                          <TouchableOpacity onPress={() => adjust('w', -2)} style={styles.adjBtn}><Text style={styles.adjTxt}>−</Text></TouchableOpacity>
                          {selectedEl === 'photo' && (
                            <>
                              <Text style={styles.adjLbl}>الارتفاع:</Text>
                              <TouchableOpacity onPress={() => adjust('h', 2)} style={styles.adjBtn}><Text style={styles.adjTxt}>+</Text></TouchableOpacity>
                              <TouchableOpacity onPress={() => adjust('h', -2)} style={styles.adjBtn}><Text style={styles.adjTxt}>−</Text></TouchableOpacity>
                            </>
                          )}
                        </>
                      ) : (
                        <>
                          <Text style={styles.adjLbl}>حجم الخط ({sel.size}):</Text>
                          <TouchableOpacity onPress={() => adjust('size', 2)} style={styles.adjBtn} testID="font-size-plus"><Text style={styles.adjTxt}>+</Text></TouchableOpacity>
                          <TouchableOpacity onPress={() => adjust('size', -2)} style={styles.adjBtn} testID="font-size-minus"><Text style={styles.adjTxt}>−</Text></TouchableOpacity>
                          <Text style={styles.adjLbl}>اللون:</Text>
                          {['#1a2540', '#ffffff', '#1b5e20', '#b71c1c', '#e65100'].map((c) => (
                            <TouchableOpacity key={c} onPress={() => setLayout((p) => ({ ...p, [selectedEl]: { ...p[selectedEl], color: c } }))}
                              style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: c, borderWidth: sel.color === c ? 3 : 1, borderColor: sel.color === c ? '#00c853' : '#ccc' }} />
                          ))}
                        </>
                      )}
                      <TouchableOpacity onPress={() => setLayout(DEFAULT_LAYOUT)} style={[styles.adjBtn, { paddingHorizontal: 10 }]} testID="reset-layout-btn">
                        <Text style={[styles.adjTxt, { fontSize: 12 }]}>↺ إعادة الافتراضي</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </>
              )}
            </View>
          )}

          {!!msg && <Text style={styles.msg} testID="card-settings-msg">{msg}</Text>}

          <TouchableOpacity onPress={save} disabled={saving || !facultyId} style={[styles.saveBtn, (saving || !facultyId) && { opacity: 0.6 }]} testID="card-settings-save-btn">
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
  uploadBtn: { flexDirection: 'row-reverse', gap: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#6a1b9a', borderStyle: 'dashed', borderRadius: 10, padding: 12, backgroundColor: '#f9f5fc' },
  adjustRow: { marginTop: 10, backgroundColor: '#fbfcfe', borderWidth: 1, borderColor: '#e6eaf2', borderRadius: 10, padding: 10 },
  adjLbl: { fontSize: 12, fontWeight: '700', color: '#5b6678' },
  adjBtn: { borderWidth: 1, borderColor: '#dde3ec', borderRadius: 6, paddingVertical: 3, paddingHorizontal: 12, backgroundColor: '#fff' },
  adjTxt: { fontSize: 15, fontWeight: '800', color: '#1a2540' },
  msg: { marginTop: 12, fontSize: 12.5, fontWeight: '700', color: '#2e7d32', textAlign: 'right' },
  saveBtn: { backgroundColor: '#00796b', borderRadius: 10, padding: 13, alignItems: 'center', marginTop: 14 },
  saveBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
