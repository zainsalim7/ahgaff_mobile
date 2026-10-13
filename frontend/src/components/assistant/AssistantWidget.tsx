import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Platform, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../../services/api';

type Msg = { role: 'user' | 'assistant'; content: string; streaming?: boolean };
const NAV_RE = /\[\[nav:([^\]|]+)\|([^\]]+)\]\]/g;
const newId = () => `as-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const splitNav = (text: string) => {
  const navs: Array<{ path: string; label: string }> = [];
  const clean = text.replace(NAV_RE, (_m, p, l) => { navs.push({ path: p.trim(), label: l.trim() }); return ''; }).replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#+\s*/gm, '').trim();
  return { clean, navs };
};

/** 🤖 مرشد الأحقاف — زر عائم + نافذة محادثة إرشادية (لا تلمس البيانات) */
export const AssistantWidget: React.FC = () => {
  const pathname = usePathname();
  const [meta, setMeta] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState(newId());
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => { api.get('/assistant/meta').then((r) => setMeta(r.data)).catch(() => setMeta(null)); }, []);
  useEffect(() => { scrollRef.current?.scrollToEnd({ animated: true }); }, [msgs]);
  if (!meta?.can_use || pathname === '/login') return null;

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setMsgs((m) => [...m, { role: 'user', content: text }, { role: 'assistant', content: '', streaming: true }]);
    setBusy(true);
    const patch = (fn: (prev: string) => string, done = false) => setMsgs((m) => { const c = [...m]; const last = c[c.length - 1]; c[c.length - 1] = { ...last, content: fn(last.content), streaming: !done }; return c; });
    try {
      const token = await AsyncStorage.getItem('token');
      const base = (process.env.EXPO_PUBLIC_BACKEND_URL || process.env.REACT_APP_BACKEND_URL || '') + '/api';
      const body = JSON.stringify({ session_id: sessionId, message: text, current_route: pathname, stream: Platform.OS === 'web' });
      if (Platform.OS !== 'web') {
        const r = await api.post('/assistant/chat', { session_id: sessionId, message: text, current_route: pathname, stream: false });
        patch(() => r.data.reply, true);
        return;
      }
      const res = await fetch(`${base}/assistant/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        const hint = res.status === 404 ? 'خدمة المرشد غير موجودة على هذا الخادم — يلزم نشر آخر نسخة من الباكند' : res.status === 502 || res.status === 504 ? 'الخادم لم يستجب في الوقت المحدد' : '';
        patch(() => (typeof j.detail === 'string' && j.detail) || `تعذر الاتصال بالمرشد (HTTP ${res.status})${hint ? ' — ' + hint : ''}`, true);
        return;
      }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n'); buf = parts.pop() || '';
        for (const p of parts) {
          if (!p.startsWith('data: ')) continue;
          const ev = JSON.parse(p.slice(6));
          if (ev.delta) patch((prev) => prev + ev.delta);
          if (ev.error) patch(() => ev.error, true);
          if (ev.done) patch((prev) => prev, true);
        }
      }
      patch((prev) => prev, true);
    } catch (e: any) {
      const st = e?.response?.status;
      patch(() => e?.response?.data?.detail || `تعذر الاتصال بالمرشد${st ? ` (HTTP ${st})` : ' — تحقق من الاتصال بالإنترنت'}`, true);
    } finally { setBusy(false); }
  };

  const reset = () => { setSessionId(newId()); setMsgs([]); };

  return (
    <>
      {!open && (
        <TouchableOpacity onPress={() => setOpen(true)} style={s.fab} testID="assistant-fab" accessibilityLabel={meta.name}>
          <Ionicons name="sparkles" size={22} color="#fff" />
        </TouchableOpacity>
      )}
      {open && (
        <View style={s.panel} testID="assistant-panel">
          <View style={s.header}>
            <TouchableOpacity onPress={() => setOpen(false)} testID="assistant-close"><Ionicons name="close" size={20} color="#fff" /></TouchableOpacity>
            <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
              <Ionicons name="sparkles" size={16} color="#ffd54f" />
              <Text style={s.headerTitle}>{meta.name}</Text>
              <Text style={s.headerSub}>إرشاد فقط · لا يعدّل بيانات</Text>
            </View>
            <TouchableOpacity onPress={reset} testID="assistant-new-chat"><Ionicons name="refresh" size={18} color="#fff" /></TouchableOpacity>
          </View>
          <ScrollView ref={scrollRef} style={s.body} contentContainerStyle={{ padding: 10, gap: 8 }} testID="assistant-messages">
            {msgs.length === 0 && (
              <View style={s.hint} testID="assistant-hint">
                <Text style={s.hintTxt}>مرحباً! اسألني كيف تنجز أي مهمة في النظام، مثل:</Text>
                {['كيف أعتمد عذراً مرضياً لطالب؟', 'كيف أوزّع طلاب مقرر على مجموعات؟', 'ما حدود الغياب في اللائحة؟'].map((q) => (
                  <TouchableOpacity key={q} onPress={() => setInput(q)} style={s.hintChip} testID="assistant-suggestion"><Text style={s.hintChipTxt}>{q}</Text></TouchableOpacity>
                ))}
              </View>
            )}
            {msgs.map((m, i) => {
              const { clean, navs } = m.role === 'assistant' ? splitNav(m.content) : { clean: m.content, navs: [] };
              return (
                <View key={i} style={[s.bubble, m.role === 'user' ? s.userBubble : s.botBubble]} testID={`assistant-msg-${m.role}`}>
                  <Text style={[s.bubbleTxt, m.role === 'user' && { color: '#fff' }]}>{clean || (m.streaming ? '…' : '')}</Text>
                  {m.streaming && !clean && <ActivityIndicator size="small" color="#1a2540" />}
                  {navs.length > 0 && !m.streaming && (
                    <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                      {navs.map((n) => <TouchableOpacity key={n.path} onPress={() => { setOpen(false); router.push(n.path as any); }} style={s.navBtn} testID="assistant-nav"><Ionicons name="arrow-back" size={12} color="#1565c0" /><Text style={s.navTxt}>{n.label}</Text></TouchableOpacity>)}
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>
          <View style={s.inputRow}>
            <TouchableOpacity onPress={send} disabled={busy || !input.trim()} style={[s.sendBtn, (busy || !input.trim()) && { opacity: 0.5 }]} testID="assistant-send"><Ionicons name="send" size={16} color="#fff" style={{ transform: [{ scaleX: -1 }] }} /></TouchableOpacity>
            <TextInput value={input} onChangeText={setInput} placeholder="اكتب سؤالك…" style={s.input} multiline onSubmitEditing={send} blurOnSubmit testID="assistant-input" />
          </View>
        </View>
      )}
    </>
  );
};

const s = StyleSheet.create({
  fab: { position: 'absolute', bottom: 24, left: 20, width: 52, height: 52, borderRadius: 26, backgroundColor: '#6a1b9a', alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, zIndex: 999 },
  panel: { position: 'absolute', bottom: 20, left: 16, width: Platform.OS === 'web' ? 400 : '92%', maxWidth: 420, height: 560, maxHeight: '85%', backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', elevation: 10, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, zIndex: 1000, borderWidth: 1, borderColor: '#e2e8f0' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#1a2540', paddingHorizontal: 12, paddingVertical: 10 },
  headerTitle: { color: '#fff', fontWeight: '800', fontSize: 14 },
  headerSub: { color: 'rgba(255,255,255,0.65)', fontSize: 10.5 },
  body: { flex: 1, backgroundColor: '#f5f7fa' },
  hint: { backgroundColor: '#fff', borderRadius: 12, padding: 12, gap: 6 },
  hintTxt: { fontSize: 13, color: '#334155', textAlign: 'right', fontWeight: '600' },
  hintChip: { backgroundColor: '#eef3f9', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  hintChipTxt: { fontSize: 12.5, color: '#1a2540', textAlign: 'right' },
  bubble: { maxWidth: '88%', borderRadius: 12, padding: 10 },
  userBubble: { alignSelf: 'flex-end', backgroundColor: '#1565c0', borderBottomRightRadius: 2 },
  botBubble: { alignSelf: 'flex-start', backgroundColor: '#fff', borderBottomLeftRadius: 2, borderWidth: 1, borderColor: '#e2e8f0' },
  bubbleTxt: { fontSize: 13.5, color: '#1e293b', textAlign: 'right', lineHeight: 21 },
  navBtn: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: '#1565c0', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  navTxt: { color: '#1565c0', fontSize: 12, fontWeight: '700' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 8, borderTopWidth: 1, borderTopColor: '#e2e8f0', backgroundColor: '#fff' },
  input: { flex: 1, maxHeight: 90, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, textAlign: 'right' },
  sendBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#1a2540', alignItems: 'center', justifyContent: 'center' },
});
