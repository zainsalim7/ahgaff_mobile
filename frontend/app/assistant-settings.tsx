import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Platform, Alert, Switch, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api from '../src/services/api';

const notify = (t: string, m: string) => (Platform.OS === 'web' ? window.alert(`${t}\n${m}`) : Alert.alert(t, m));

/** 🤖 إعدادات مرشد الأحقاف: تفعيل، اختيار النموذج/المزوّد، الحد اليومي، من يُسمح له (أدوار/مستخدمون)، تعليمات إضافية */
export default function AssistantSettingsScreen() {
  const [st, setSt] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [q, setQ] = useState(''); const [found, setFound] = useState<any[]>([]);
  const [keyDraft, setKeyDraft] = useState<Record<string, string>>({});
  const [diag, setDiag] = useState<string | null>(null);

  const load = () => api.get('/assistant/settings').then((r) => setSt(r.data)).catch((e) => notify('خطأ', e?.response?.data?.detail || 'تعذر التحميل'));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(() => api.get('/assistant/users/search', { params: { q: q.trim() } }).then((r) => setFound(r.data)).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [q]);

  const save = async (patch: any) => {
    setSaving(true);
    try { await api.put('/assistant/settings', patch); await load(); } catch (e: any) { notify('خطأ', e?.response?.data?.detail || 'فشل الحفظ'); } finally { setSaving(false); }
  };
  const test = async (model: string) => {
    setTesting(model);
    const t0 = Date.now();
    try { const r = await api.post('/assistant/test', { model }, { timeout: 60000 }); notify('نجح الاختبار ✅', `الرد: ${r.data.reply} (${r.data.ms} ms)\nالمفتاح المستخدم: ${r.data.key_source_label}`); }
    catch (e: any) {
      const sec = Math.round((Date.now() - t0) / 1000);
      const st = e?.response?.status;
      const net = !e?.response ? `\n⚠️ لم يصل أي رد من الخادم بعد ${sec} ث (${e?.message || 'Network Error'}) — غالباً انتهت مهلة الوسيط (Cloudflare/Cloud Run) أو خطأ 500 غير معالج. اضغط «تشخيص» بجانب المزوّد لمعرفة السبب.` : '';
      notify('فشل الاختبار', (e?.response?.data?.detail || `خطأ${st ? ` (HTTP ${st})` : ''}`) + net);
    } finally { setTesting(null); }
  };
  const diagnose = async (provider: string) => {
    setDiag(provider);
    try {
      const r = await api.get(`/assistant/diagnose/${provider}`, { timeout: 30000 });
      const lines = (r.data.steps || []).map((s: any) => `${s.ok ? '✅' : '❌'} ${s.step}: ${s.msg}`).join('\n');
      notify(r.data.ok === false ? 'نتيجة التشخيص ❌' : 'نتيجة التشخيص', lines + (r.data.universal_env ? '' : '\nℹ️ المفتاح الشامل (EMERGENT_LLM_KEY) غير مهيأ على هذا الخادم.'));
    } catch (e: any) { notify('فشل التشخيص', e?.response?.data?.detail || e?.message || 'خطأ'); } finally { setDiag(null); }
  };

  const saveKey = async (provider: string) => {
    const raw = (keyDraft[provider] || '').trim();
    if (!raw) return;
    setSaving(true);
    try { await api.put(`/assistant/provider-keys/${provider}`, { api_key: raw }); setKeyDraft({ ...keyDraft, [provider]: '' }); await load(); notify('تم الحفظ ✅', 'حُفظ المفتاح مشفّراً. اضغط «اختبار» على أحد نماذج هذا المزوّد للتأكد.'); }
    catch (e: any) { notify('خطأ', e?.response?.data?.detail || 'فشل حفظ المفتاح'); } finally { setSaving(false); }
  };
  const removeKey = async (provider: string) => {
    if (Platform.OS === 'web' && !window.confirm('حذف المفتاح الخاص لهذا المزوّد؟')) return;
    setSaving(true);
    try { await api.delete(`/assistant/provider-keys/${provider}`); await load(); } catch (e: any) { notify('خطأ', e?.response?.data?.detail || 'فشل الحذف'); } finally { setSaving(false); }
  };

  if (!st) return <View style={s.center}><ActivityIndicator color="#1a2540" size="large" /></View>;
  const allowedIds: string[] = st.allowed_user_ids || [];
  const providerOf = (key: string) => (st.providers || []).find((p: any) => p.key === key) || {};

  return (
    <SafeAreaView style={s.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} testID="assistant-settings-screen">
        <View style={s.info}><Ionicons name="shield-checkmark" size={18} color="#1e3a8a" /><Text style={s.infoTxt}>المرشد في مرحلة «الإرشاد فقط»: يشرح الخطوات ويوجّه للشاشات حسب صلاحيات كل مستخدم، ولا ينفّذ عمليات ولا يطّلع على بيانات الطلاب أو الموظفين. مدير النظام يستخدمه دائماً؛ غيره يحتاج إذناً هنا أو صلاحية «استخدام مرشد الأحقاف» من الأدوار.</Text></View>
        {!st.key_configured && <View style={[s.info, { backgroundColor: '#fee2e2' }]} testID="assistant-universal-key-missing"><Text style={[s.infoTxt, { color: '#b91c1c' }]}>⚠️ المفتاح الشامل (EMERGENT_LLM_KEY) غير مهيأ على هذا الخادم — أدخل مفتاحك الخاص لكل مزوّد في قسم «مفاتيح المزوّدين» أدناه.</Text></View>}

        <View style={s.card} testID="assistant-provider-keys">
          <Text style={s.cardTitle}>🔐 مفاتيح المزوّدين (API Keys)</Text>
          <Text style={s.sub}>أدخل مفتاحك الخاص لأي مزوّد؛ يُحفظ مشفّراً ولا يُعرض كاملاً مرة أخرى. بدون مفتاح خاص يُستخدم المفتاح الشامل تلقائياً للمزوّدين المشمولين به (OpenAI/Anthropic/Gemini). DeepSeek يتطلب مفتاحاً خاصاً.</Text>
          {(st.providers || []).map((p: any) => (
            <View key={p.key} style={s.provRow} testID={`assistant-provider-${p.key}`}>
              <View style={s.rowBetween}>
                <View style={[s.badge, p.source === 'own' ? s.badgeOwn : p.source === 'universal' ? s.badgeUni : s.badgeNone]} testID={`assistant-provider-source-${p.key}`}>
                  <Text style={s.badgeTxt}>{p.source === 'own' ? `مفتاح خاص ••••${p.last4}` : p.source === 'universal' ? 'المفتاح الشامل' : 'لا يوجد مفتاح'}</Text>
                </View>
                <View style={{ flex: 1, marginLeft: 8 }}><Text style={s.modelLbl}>{p.label}</Text><Text style={s.modelSub}>الحصول على المفتاح: {p.hint}</Text></View>
              </View>
              <View style={{ flexDirection: 'row-reverse', gap: 6, alignItems: 'center', marginTop: 6 }}>
                <TextInput value={keyDraft[p.key] || ''} onChangeText={(v) => setKeyDraft({ ...keyDraft, [p.key]: v })} placeholder={p.has_own_key ? 'استبدال المفتاح الحالي…' : `الصق مفتاح ${p.label} هنا (${p.prefix}…)`} secureTextEntry autoCapitalize="none" autoCorrect={false} style={[s.input, { flex: 1 }]} testID={`assistant-provider-key-input-${p.key}`} />
                <TouchableOpacity onPress={() => saveKey(p.key)} disabled={saving || !(keyDraft[p.key] || '').trim()} style={[s.testBtn, !(keyDraft[p.key] || '').trim() && { opacity: 0.4 }]} testID={`assistant-provider-key-save-${p.key}`}><Text style={s.testTxt}>حفظ</Text></TouchableOpacity>
                {p.has_own_key && <TouchableOpacity onPress={() => removeKey(p.key)} disabled={saving} style={[s.testBtn, { borderColor: '#c62828' }]} testID={`assistant-provider-key-delete-${p.key}`}><Text style={[s.testTxt, { color: '#c62828' }]}>حذف</Text></TouchableOpacity>}
                {!!p.source && <TouchableOpacity onPress={() => diagnose(p.key)} disabled={!!diag} style={[s.testBtn, { borderColor: '#6a1b9a' }]} testID={`assistant-provider-diagnose-${p.key}`}>{diag === p.key ? <ActivityIndicator size="small" color="#6a1b9a" /> : <Text style={[s.testTxt, { color: '#6a1b9a' }]}>تشخيص</Text>}</TouchableOpacity>}
              </View>
            </View>
          ))}
        </View>

        <View style={s.card}>
          <View style={s.rowBetween}>
            <Switch value={!!st.enabled} onValueChange={(v) => save({ enabled: v })} testID="assistant-enabled-switch" />
            <Text style={s.cardTitle}>تفعيل المرشد لغير مدير النظام</Text>
          </View>
          <Text style={s.lbl}>اسم المرشد</Text>
          <TextInput value={st.name} onChangeText={(v) => setSt({ ...st, name: v })} onBlur={() => save({ name: st.name })} style={s.input} testID="assistant-name-input" />
          <Text style={s.lbl}>الحد اليومي للرسائل لكل مستخدم (لا ينطبق على الأدمن)</Text>
          <TextInput value={String(st.daily_limit)} keyboardType="numeric" onChangeText={(v) => setSt({ ...st, daily_limit: Number(v) || 0 })} onBlur={() => save({ daily_limit: st.daily_limit })} style={[s.input, { width: 120 }]} testID="assistant-daily-limit" />
          <Text style={s.sub}>الاستخدام اليوم: {st.usage_today} رسالة</Text>
        </View>

        <View style={s.card} testID="assistant-models">
          <Text style={s.cardTitle}>🧠 أداة الذكاء الاصطناعي المستخدمة</Text>
          <Text style={s.sub}>بدّل بين النماذج حسب الحاجة (السرعة/التكلفة/الدقة). «اختبار» يرسل رسالة قصيرة للتأكد من عمل النموذج.</Text>
          {st.models.map((m: any) => {
            const on = m.model === st.model;
            const prov = providerOf(m.provider);
            const noKey = !prov.source;
            return (
              <View key={m.model} style={[s.modelRow, on && s.modelOn]}>
                <TouchableOpacity onPress={() => test(m.model)} disabled={!!testing} style={s.testBtn} testID={`assistant-test-${m.model}`}>{testing === m.model ? <ActivityIndicator size="small" color="#1565c0" /> : <Text style={s.testTxt}>اختبار</Text>}</TouchableOpacity>
                <TouchableOpacity onPress={() => save({ model: m.model })} style={{ flex: 1, flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }} testID={`assistant-model-${m.model}`}>
                  <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={18} color={on ? '#6a1b9a' : '#94a3b8'} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.modelLbl}>{m.label}</Text>
                    <Text style={s.modelSub}>{m.provider} · {m.model}{prov.source === 'own' ? ' · 🔑 مفتاح خاص' : prov.source === 'universal' ? ' · المفتاح الشامل' : ''}</Text>
                    {noKey && <Text style={[s.modelSub, { color: '#b91c1c' }]} testID={`assistant-model-nokey-${m.model}`}>⚠️ {prov.universal === false ? `${prov.label} غير مشمول بالمفتاح الشامل — أدخل مفتاحك الخاص أعلاه` : 'لا يوجد مفتاح لهذا المزوّد — أدخل مفتاحاً خاصاً أعلاه'}</Text>}
                  </View>
                </TouchableOpacity>
              </View>
            );
          })}
        </View>

        <View style={s.card} testID="assistant-access">
          <Text style={s.cardTitle}>🔑 من يُسمح له باستخدام المرشد</Text>
          <Text style={s.lbl}>أدوار كاملة</Text>
          <View style={s.chips}>{st.roles.map((r: any) => { const on = (st.allowed_roles || []).includes(r.key); return (
            <TouchableOpacity key={r.key} onPress={() => save({ allowed_roles: on ? st.allowed_roles.filter((x: string) => x !== r.key) : [...(st.allowed_roles || []), r.key] })} style={[s.chip, on && s.chipOn]} testID={`assistant-role-${r.key}`}><Text style={[s.chipTxt, on && { color: '#fff' }]}>{r.label}</Text></TouchableOpacity>); })}</View>
          <Text style={s.lbl}>مستخدمون محددون</Text>
          <View style={s.chips}>{(st.allowed_users || []).map((u: any) => (
            <View key={u.id} style={[s.chip, { flexDirection: 'row-reverse', gap: 6, alignItems: 'center' }]} testID={`assistant-user-${u.id}`}><Text style={s.chipTxt}>{u.full_name} ({u.username})</Text><TouchableOpacity onPress={() => save({ allowed_user_ids: allowedIds.filter((x) => x !== u.id) })} testID={`assistant-user-remove-${u.id}`}><Ionicons name="close-circle" size={16} color="#c62828" /></TouchableOpacity></View>))}
            {(st.allowed_users || []).length === 0 && <Text style={s.sub}>لا يوجد</Text>}
          </View>
          <TextInput value={q} onChangeText={setQ} placeholder="ابحث عن مستخدم بالاسم أو اسم الدخول لإضافته…" style={s.input} testID="assistant-user-search" />
          {found.map((u) => !allowedIds.includes(u.id) && (
            <TouchableOpacity key={u.id} onPress={() => { save({ allowed_user_ids: [...allowedIds, u.id] }); setQ(''); setFound([]); }} style={s.result} testID={`assistant-user-add-${u.id}`}><Text style={s.chipTxt}>＋ {u.full_name} · {u.username} · {u.role_label}</Text></TouchableOpacity>
          ))}
          <Text style={s.sub}>ملاحظة: الإذن هنا يتيح فتح المرشد فقط؛ ما يراه المستخدم من إرشادات محكوم بصلاحيات دوره.</Text>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>📝 تعليمات إضافية للمرشد (اختياري)</Text>
          <TextInput value={st.extra_instructions} onChangeText={(v) => setSt({ ...st, extra_instructions: v })} onBlur={() => save({ extra_instructions: st.extra_instructions })} multiline style={[s.input, { minHeight: 80 }]} placeholder="مثال: ذكّر المستخدمين دائماً بمراجعة التسجيل قبل نقل الطلاب…" testID="assistant-extra-instructions" />
        </View>
        {saving && <Text style={[s.sub, { textAlign: 'center' }]}>جاري الحفظ…</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  info: { flexDirection: 'row-reverse', gap: 8, backgroundColor: '#dbeafe', borderRadius: 12, padding: 12, marginBottom: 12, alignItems: 'flex-start' },
  infoTxt: { flex: 1, color: '#1e3a8a', fontSize: 12.5, lineHeight: 19, textAlign: 'right' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#e6eaf0' },
  cardTitle: { fontSize: 15, fontWeight: '800', color: '#1a2540', textAlign: 'right', marginBottom: 6 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lbl: { fontSize: 12, fontWeight: '700', color: '#5b6678', textAlign: 'right', marginTop: 10, marginBottom: 4 },
  sub: { fontSize: 11.5, color: '#64748b', textAlign: 'right', marginTop: 6 },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, textAlign: 'right', backgroundColor: '#f9fafb' },
  modelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  modelOn: { backgroundColor: '#f3e5f5', borderRadius: 8, paddingHorizontal: 6 },
  modelLbl: { fontSize: 13, fontWeight: '700', color: '#1a2540', textAlign: 'right' }, modelSub: { fontSize: 11, color: '#64748b', textAlign: 'right' },
  testBtn: { borderWidth: 1, borderColor: '#1565c0', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, minWidth: 64, alignItems: 'center' }, testTxt: { color: '#1565c0', fontSize: 12, fontWeight: '700' },
  chips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  chip: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: '#f8fafc' }, chipOn: { backgroundColor: '#6a1b9a', borderColor: '#6a1b9a' },
  chipTxt: { fontSize: 12, fontWeight: '700', color: '#1a2540' },
  result: { padding: 8, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  provRow: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  badge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 }, badgeTxt: { fontSize: 11, fontWeight: '700', color: '#fff' },
  badgeOwn: { backgroundColor: '#2e7d32' }, badgeUni: { backgroundColor: '#1565c0' }, badgeNone: { backgroundColor: '#9e9e9e' },
});
