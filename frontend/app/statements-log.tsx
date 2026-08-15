import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView,
  Platform, ActivityIndicator, Modal, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Picker } from '@react-native-picker/picker';
import api from '../src/services/api';
import { useAuth } from '../src/contexts/AuthContext';

interface StatementRow {
  id: string;
  number_display: string;
  student_name: string;
  enrollment_no: string;
  faculty_id: string;
  faculty_name: string;
  department_name: string;
  issued_by_name: string;
  issued_at: string;
  expires_at?: string;
  is_revoked?: boolean;
  revoked_by_name?: string;
  revoke_reason?: string;
  verify_url?: string;
  template_name?: string;
}

const statusOf = (s: StatementRow) => {
  if (s.is_revoked) return { label: 'ملغاة', color: '#c62828', bg: '#ffebee' };
  if (s.expires_at && s.expires_at < new Date().toISOString()) return { label: 'منتهية', color: '#e65100', bg: '#fff3e0' };
  return { label: 'سارية', color: '#2e7d32', bg: '#e8f5e9' };
};

export default function StatementsLogScreen() {
  const { user } = useAuth();
  const [items, setItems] = useState<StatementRow[]>([]);
  const [faculties, setFaculties] = useState<{ id: string; name: string }[]>([]);
  const [facultyFilter, setFacultyFilter] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<StatementRow | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [acting, setActing] = useState(false);
  const [msg, setMsg] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const [stRes, facRes] = await Promise.all([
        api.get('/statements', { params: facultyFilter ? { faculty_id: facultyFilter } : {} }),
        api.get('/faculties'),
      ]);
      setItems(stRes.data || []);
      setFaculties((facRes.data || []).map((f: any) => ({ id: f.id || f._id, name: f.name })));
    } catch (e: any) {
      setMsg(e?.response?.data?.detail || 'فشل جلب سجل الإفادات');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [facultyFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    const q = search.trim();
    if (!q) return items;
    return items.filter((s) =>
      (s.student_name || '').includes(q) ||
      (s.number_display || '').includes(q) ||
      (s.enrollment_no || '').includes(q)
    );
  }, [items, search]);

  const downloadPdf = async (s: StatementRow) => {
    try {
      const res = await api.get(`/statements/${s.id}/pdf`, { responseType: 'blob' });
      if (Platform.OS === 'web') {
        const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `إفادة ${s.student_name || s.number_display.replace(/\//g, '-')}.pdf`;
        a.click();
        window.URL.revokeObjectURL(url);
      }
    } catch {
      setMsg('فشل تنزيل الـPDF');
    }
  };

  const copyLink = async (s: StatementRow) => {
    if (Platform.OS === 'web' && s.verify_url && navigator.clipboard) {
      await navigator.clipboard.writeText(s.verify_url);
      setMsg(`✅ نُسخ رابط التحقق للإفادة ${s.number_display}`);
      setTimeout(() => setMsg(''), 2500);
    }
  };

  const doRevoke = async () => {
    if (!revokeTarget) return;
    setActing(true);
    try {
      await api.post(`/statements/${revokeTarget.id}/revoke`, { reason: revokeReason });
      setRevokeTarget(null);
      setRevokeReason('');
      fetchData();
    } catch (e: any) {
      setMsg(e?.response?.data?.detail || 'فشل الإلغاء');
    } finally {
      setActing(false);
    }
  };

  const doRestore = async (s: StatementRow) => {
    if (Platform.OS === 'web' && !window.confirm(`استعادة صلاحية الإفادة ${s.number_display}؟`)) return;
    try {
      await api.post(`/statements/${s.id}/restore`);
      fetchData();
    } catch (e: any) {
      setMsg(e?.response?.data?.detail || 'فشل الاستعادة');
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
      <ScrollView
        contentContainerStyle={{ padding: 14, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} />}
      >
        <View style={styles.headerCard}>
          <Text style={styles.title}>📑 سجل الإفادات الصادرة ({filtered.length})</Text>
          <View style={styles.filtersRow}>
            <View style={[styles.searchWrap, { flex: 1.4 }]}>
              <Ionicons name="search" size={15} color="#8a95a8" />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="بحث بالاسم / رقم الإفادة / رقم القيد"
                placeholderTextColor="#9aa4b2"
                style={styles.searchInput}
                testID="statements-search-input"
              />
            </View>
            {(user?.role === 'admin' || faculties.length > 1) && (
              <View style={[styles.pickerWrap, { flex: 1 }]}>
                <Picker selectedValue={facultyFilter} onValueChange={(v) => setFacultyFilter(String(v))} style={styles.picker} testID="statements-faculty-filter">
                  <Picker.Item label="كل الكليات" value="" />
                  {faculties.map((f) => <Picker.Item key={f.id} label={f.name} value={f.id} />)}
                </Picker>
              </View>
            )}
          </View>
          {!!msg && <Text style={styles.msgText} testID="statements-msg">{msg}</Text>}
        </View>

        {filtered.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="document-text-outline" size={44} color="#cfd6e1" />
            <Text style={styles.emptyText}>لا توجد إفادات</Text>
          </View>
        ) : filtered.map((s) => {
          const st = statusOf(s);
          return (
            <View key={s.id} style={styles.card} testID={`statement-row-${s.id}`}>
              <View style={styles.cardTop}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={[styles.chip, { backgroundColor: st.bg }]}>
                    <Text style={[styles.chipText, { color: st.color }]}>{st.label}</Text>
                  </View>
                  {!!s.template_name && (
                    <View style={[styles.chip, { backgroundColor: '#ede7f6' }]} testID={`statement-type-badge-${s.id}`}>
                      <Text style={[styles.chipText, { color: '#5e35b1' }]}>📋 {s.template_name}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.number}>إفادة رقم {s.number_display}</Text>
              </View>
              <Text style={styles.studentName}>{s.student_name} <Text style={styles.dim}>({s.enrollment_no})</Text></Text>
              <Text style={styles.meta}>{s.faculty_name} — {s.department_name}</Text>
              <Text style={styles.meta}>
                أصدرها: {s.issued_by_name || '—'} · بتاريخ {String(s.issued_at || '').slice(0, 10)}
                {s.expires_at ? ` · صالحة حتى ${String(s.expires_at).slice(0, 10)}` : ''}
              </Text>
              {s.is_revoked && (
                <Text style={styles.revokedNote}>
                  ألغاها: {s.revoked_by_name || '—'}{s.revoke_reason ? ` — السبب: ${s.revoke_reason}` : ''}
                </Text>
              )}
              <View style={styles.actionsRow}>
                <TouchableOpacity onPress={() => downloadPdf(s)} style={styles.actionBtn} testID={`statement-pdf-btn-${s.id}`}>
                  <Ionicons name="download-outline" size={14} color="#00796b" />
                  <Text style={styles.actionText}>PDF</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => copyLink(s)} style={styles.actionBtn} testID={`statement-copy-btn-${s.id}`}>
                  <Ionicons name="link-outline" size={14} color="#1565c0" />
                  <Text style={[styles.actionText, { color: '#1565c0' }]}>نسخ رابط التحقق</Text>
                </TouchableOpacity>
                {s.is_revoked ? (
                  <TouchableOpacity onPress={() => doRestore(s)} style={[styles.actionBtn, { borderColor: '#a5d6a7' }]} testID={`statement-restore-btn-${s.id}`}>
                    <Ionicons name="refresh-outline" size={14} color="#2e7d32" />
                    <Text style={[styles.actionText, { color: '#2e7d32' }]}>استعادة</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity onPress={() => { setRevokeTarget(s); setRevokeReason(''); }} style={[styles.actionBtn, { borderColor: '#ffcdd2' }]} testID={`statement-revoke-btn-${s.id}`}>
                    <Ionicons name="ban-outline" size={14} color="#c62828" />
                    <Text style={[styles.actionText, { color: '#c62828' }]}>إلغاء</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* نافذة تأكيد الإلغاء */}
      <Modal visible={!!revokeTarget} transparent animationType="fade" onRequestClose={() => setRevokeTarget(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox} testID="revoke-modal">
            <Text style={styles.modalTitle}>⚠️ إلغاء الإفادة رقم {revokeTarget?.number_display}</Text>
            <Text style={styles.modalHint}>
              بعد الإلغاء، أي شخص يمسح رمز QR سيرى أن الإفادة ملغاة ولا يُعتد بها. يمكنك استعادتها لاحقاً.
            </Text>
            <Text style={styles.label}>سبب الإلغاء (اختياري)</Text>
            <TextInput
              value={revokeReason}
              onChangeText={setRevokeReason}
              placeholder="مثال: خطأ في البيانات"
              placeholderTextColor="#9aa4b2"
              style={styles.input}
              testID="revoke-reason-input"
            />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <TouchableOpacity onPress={doRevoke} disabled={acting} style={[styles.revokeBtn, acting && { opacity: 0.6 }]} testID="revoke-confirm-btn">
                {acting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.revokeBtnText}>تأكيد الإلغاء</Text>}
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setRevokeTarget(null)} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnText}>تراجع</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f6fb' },
  headerCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: '#e6eaf2', maxWidth: 900, width: '100%', alignSelf: 'center',
  },
  title: { fontSize: 16, fontWeight: '800', color: '#1a2540', textAlign: 'right', marginBottom: 10 },
  filtersRow: { flexDirection: 'row-reverse', gap: 8, flexWrap: 'wrap' },
  searchWrap: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 6, borderWidth: 1,
    borderColor: '#dde3ec', borderRadius: 8, paddingHorizontal: 10, backgroundColor: '#fbfcfe', minWidth: 220,
  },
  searchInput: { flex: 1, paddingVertical: 8, fontSize: 12.5, textAlign: 'right', color: '#1a2540' },
  pickerWrap: { borderWidth: 1, borderColor: '#dde3ec', borderRadius: 8, backgroundColor: '#fbfcfe', overflow: 'hidden', minWidth: 180 },
  picker: { height: 38, width: '100%' },
  msgText: { fontSize: 12, fontWeight: '700', color: '#2e7d32', textAlign: 'right', marginTop: 8 },
  emptyBox: { alignItems: 'center', padding: 40, gap: 8 },
  emptyText: { fontSize: 13, color: '#8a95a8' },
  card: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: '#e6eaf2', maxWidth: 900, width: '100%', alignSelf: 'center',
  },
  cardTop: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  number: { fontSize: 13, fontWeight: '800', color: '#00796b' },
  chip: { borderRadius: 20, paddingVertical: 3, paddingHorizontal: 10 },
  chipText: { fontSize: 11, fontWeight: '800' },
  studentName: { fontSize: 14, fontWeight: '800', color: '#1a2540', textAlign: 'right' },
  dim: { fontSize: 12, fontWeight: '400', color: '#8a95a8' },
  meta: { fontSize: 11.5, color: '#5b6678', textAlign: 'right', marginTop: 3 },
  revokedNote: { fontSize: 11.5, color: '#c62828', textAlign: 'right', marginTop: 4, fontWeight: '700' },
  actionsRow: { flexDirection: 'row-reverse', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  actionBtn: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 4, borderWidth: 1,
    borderColor: '#d5e8e5', borderRadius: 7, paddingVertical: 6, paddingHorizontal: 10,
  },
  actionText: { fontSize: 11.5, fontWeight: '700', color: '#00796b' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modalBox: { backgroundColor: '#fff', borderRadius: 12, padding: 20, width: '100%', maxWidth: 440 },
  modalTitle: { fontSize: 15, fontWeight: '800', color: '#c62828', textAlign: 'right', marginBottom: 6 },
  modalHint: { fontSize: 12, color: '#5b6678', textAlign: 'right', lineHeight: 19, marginBottom: 12 },
  label: { fontSize: 12, fontWeight: '700', color: '#1a2540', textAlign: 'right', marginBottom: 4 },
  input: {
    borderWidth: 1, borderColor: '#dde3ec', borderRadius: 8, padding: 10,
    textAlign: 'right', fontSize: 13, backgroundColor: '#fbfcfe', color: '#1a2540',
  },
  revokeBtn: { flex: 1, backgroundColor: '#c62828', borderRadius: 8, padding: 12, alignItems: 'center' },
  revokeBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  cancelBtn: { flex: 0.6, borderWidth: 1, borderColor: '#dde3ec', borderRadius: 8, padding: 12, alignItems: 'center' },
  cancelBtnText: { color: '#555', fontWeight: '600', fontSize: 13 },
});
