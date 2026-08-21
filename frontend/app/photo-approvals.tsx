import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Image, RefreshControl, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import api from '../src/services/api';
import { useAuthStore } from '../src/store/authStore';

export default function PhotoApprovalsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<'pending' | 'approved'>('pending');
  const [approved, setApproved] = useState<any[]>([]);
  const [approvedSearch, setApprovedSearch] = useState('');

  const fetchApproved = useCallback(async (q?: string) => {
    try {
      const res = await api.get('/approved-photos', { params: q ? { search: q } : {} });
      setApproved(res.data || []);
    } catch (e: any) {
      setMsg(e?.response?.data?.detail || 'فشل جلب الصور المعتمدة');
    }
  }, []);

  useEffect(() => { if (tab === 'approved') fetchApproved(approvedSearch); }, [tab]);
  useEffect(() => {
    if (tab !== 'approved') return;
    const t = setTimeout(() => fetchApproved(approvedSearch), 400);
    return () => clearTimeout(t);
  }, [approvedSearch]);

  const token = useAuthStore.getState().token;
  const fileUrl = (path: string) => `${api.defaults.baseURL}/files/${path}?auth=${token}`;

  const fetchData = useCallback(async () => {
    try {
      const res = await api.get('/pending-photos');
      setItems(res.data || []);
    } catch (e: any) {
      setMsg(e?.response?.data?.detail || 'فشل جلب الصور المعلقة');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const decide = async (id: string, action: 'approve' | 'reject') => {
    setBusy(id + action);
    try {
      await api.post(`/students/${id}/photo/${action}`);
      fetchData();
    } catch (e: any) {
      setMsg(e?.response?.data?.detail || 'فشل الإجراء');
    } finally {
      setBusy('');
    }
  };

  const revokePhoto = async (id: string, name: string) => {
    if (typeof window !== 'undefined' && !window.confirm(`إلغاء اعتماد صورة «${name}»؟ ستُسحب من البطاقة ويُفتح للطالب رفع صورة جديدة.`)) return;
    setBusy(id + 'revoke');
    try {
      const r = await api.post(`/students/${id}/photo/revoke`);
      setMsg(r.data?.message || '');
      fetchApproved(approvedSearch);
    } catch (e: any) {
      setMsg(e?.response?.data?.detail || 'فشل إلغاء الاعتماد');
    } finally {
      setBusy('');
    }
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const bulkDecide = async (action: 'approve' | 'reject') => {
    if (selected.size === 0) return;
    const verb = action === 'approve' ? 'اعتماد' : 'رفض';
    if (typeof window !== 'undefined' && !window.confirm(`${verb} ${selected.size} صورة دفعة واحدة؟`)) return;
    setBusy('bulk');
    try {
      const r = await api.post('/photos/bulk-decision', { student_ids: Array.from(selected), action });
      setMsg(r.data?.message || '');
      setSelected(new Set());
      setSelectMode(false);
      fetchData();
    } catch (e: any) {
      setMsg(e?.response?.data?.detail || 'فشل الإجراء الجماعي');
    } finally {
      setBusy('');
    }
  };

  if (loading) {
    return <SafeAreaView style={styles.container}><ActivityIndicator size="large" color="#00796b" style={{ marginTop: 60 }} /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={{ padding: 14 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} />}
      >
        <Text style={styles.title}>🖼️ صور الطلاب</Text>
        <View style={{ flexDirection: 'row-reverse', gap: 8, marginTop: 10, marginBottom: 6 }}>
          <TouchableOpacity onPress={() => setTab('pending')} style={[styles.tabBtn, tab === 'pending' && styles.tabBtnOn]} data-testid="tab-pending">
            <Text style={[styles.tabText, tab === 'pending' && styles.tabTextOn]}>⏳ المعلقة ({items.length})</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setTab('approved')} style={[styles.tabBtn, tab === 'approved' && styles.tabBtnOn]} data-testid="tab-approved">
            <Text style={[styles.tabText, tab === 'approved' && styles.tabTextOn]}>✅ المعتمدة{tab === 'approved' ? ` (${approved.length})` : ''}</Text>
          </TouchableOpacity>
        </View>
        {tab === 'pending' && <Text style={styles.hint}>صور رفعها الطلاب من تطبيقهم — تظهر على البطاقة الرقمية بعد اعتمادها فقط.</Text>}
        {!!msg && <Text style={styles.msg} data-testid="approvals-msg">{msg}</Text>}
        {tab === 'approved' ? (
          <>
            <TextInput
              style={styles.search}
              value={approvedSearch}
              onChangeText={setApprovedSearch}
              placeholder="🔍 ابحث بالاسم أو رقم القيد..."
              placeholderTextColor="#8a95a8"
              data-testid="approved-search-input"
            />
            {approved.length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons name="images-outline" size={44} color="#b0bec5" />
                <Text style={styles.emptyText}>لا توجد صور معتمدة{approvedSearch ? ' مطابقة للبحث' : ''}</Text>
              </View>
            ) : (
              <View style={styles.grid}>
                {approved.map((s) => (
                  <View key={s.id} style={styles.cardBox} data-testid={`approved-photo-${s.id}`}>
                    <Image source={{ uri: fileUrl(s.photo_path) }} style={styles.photo} resizeMode="cover" />
                    <Text style={styles.name}>{s.full_name}</Text>
                    <Text style={styles.meta}>قيد: {s.student_id} · م{s.level}</Text>
                    <View style={{ flexDirection: 'row-reverse', gap: 6, marginTop: 8 }}>
                      <TouchableOpacity onPress={() => router.push(`/student-card?studentId=${s.id}`)} style={[styles.btn, { backgroundColor: '#1565c0' }]}>
                        <Text style={styles.btnText}>البطاقة</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => revokePhoto(s.id, s.full_name)} disabled={!!busy} style={[styles.btn, { backgroundColor: '#e65100' }]} data-testid={`revoke-photo-btn-${s.id}`}>
                        <Text style={styles.btnText}>إلغاء الاعتماد</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </>
        ) : (
        <>
        {items.length > 0 && (
          <View style={{ flexDirection: 'row-reverse', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <TouchableOpacity
              onPress={() => { setSelectMode(!selectMode); setSelected(new Set()); }}
              style={[styles.topBtn, { backgroundColor: selectMode ? '#5b6678' : '#1565c0' }]}
              data-testid="toggle-select-mode-btn"
            >
              <Text style={styles.btnText}>{selectMode ? 'إلغاء التحديد' : '☑️ تحديد'}</Text>
            </TouchableOpacity>
            {selectMode && (
              <>
                <TouchableOpacity
                  onPress={() => setSelected(selected.size === items.length ? new Set() : new Set(items.map(s => s.id)))}
                  style={[styles.topBtn, { backgroundColor: '#00695c' }]}
                  data-testid="select-all-btn"
                >
                  <Text style={styles.btnText}>{selected.size === items.length ? 'إلغاء الكل' : `تحديد الكل (${items.length})`}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => bulkDecide('approve')}
                  disabled={!!busy || selected.size === 0}
                  style={[styles.topBtn, { backgroundColor: '#2e7d32', opacity: selected.size === 0 ? 0.5 : 1 }]}
                  data-testid="bulk-approve-btn"
                >
                  <Text style={styles.btnText}>✅ اعتماد المحدد ({selected.size})</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => bulkDecide('reject')}
                  disabled={!!busy || selected.size === 0}
                  style={[styles.topBtn, { backgroundColor: '#c62828', opacity: selected.size === 0 ? 0.5 : 1 }]}
                  data-testid="bulk-reject-btn"
                >
                  <Text style={styles.btnText}>❌ رفض المحدد ({selected.size})</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}
        {!!msg && <Text style={styles.msg} data-testid="approvals-msg-pending">{msg}</Text>}
        {items.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="checkmark-done-circle-outline" size={44} color="#a5d6a7" />
            <Text style={styles.emptyText}>لا توجد صور بانتظار الاعتماد</Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {items.map((s) => (
              <TouchableOpacity
                key={s.id}
                activeOpacity={selectMode ? 0.7 : 1}
                onPress={() => selectMode && toggleSelect(s.id)}
                style={[styles.cardBox, selectMode && selected.has(s.id) && styles.cardSelected]}
                data-testid={`pending-photo-${s.id}`}
              >
                {selectMode && (
                  <View style={[styles.checkCircle, selected.has(s.id) && styles.checkCircleOn]} data-testid={`photo-checkbox-${s.id}`}>
                    {selected.has(s.id) && <Ionicons name="checkmark" size={15} color="#fff" />}
                  </View>
                )}
                <Image source={{ uri: fileUrl(s.pending_photo_path) }} style={styles.photo} resizeMode="cover" />
                <Text style={styles.name}>{s.full_name}</Text>
                <Text style={styles.meta}>قيد: {s.student_id} · م{s.level}</Text>
                {!selectMode && (
                  <View style={{ flexDirection: 'row-reverse', gap: 6, marginTop: 8 }}>
                    <TouchableOpacity onPress={() => decide(s.id, 'approve')} disabled={!!busy} style={[styles.btn, { backgroundColor: '#2e7d32' }]} data-testid={`approve-btn-${s.id}`}>
                      <Text style={styles.btnText}>اعتماد</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => decide(s.id, 'reject')} disabled={!!busy} style={[styles.btn, { backgroundColor: '#c62828' }]} data-testid={`reject-btn-${s.id}`}>
                      <Text style={styles.btnText}>رفض</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => router.push(`/student-card?studentId=${s.id}`)} style={[styles.btn, { backgroundColor: '#1565c0' }]} data-testid={`view-card-btn-${s.id}`}>
                      <Text style={styles.btnText}>البطاقة</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}
        </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f6fb' },
  title: { fontSize: 16, fontWeight: '800', color: '#1a2540', textAlign: 'right' },
  hint: { fontSize: 12, color: '#5b6678', textAlign: 'right', marginTop: 4, marginBottom: 12 },
  msg: { fontSize: 12.5, fontWeight: '700', color: '#c62828', textAlign: 'right', marginBottom: 8 },
  emptyBox: { alignItems: 'center', padding: 40, gap: 8 },
  emptyText: { fontSize: 13, color: '#8a95a8' },
  grid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 10 },
  cardBox: { backgroundColor: '#fff', borderRadius: 12, padding: 10, width: 220, borderWidth: 1, borderColor: '#e6eaf2' },
  cardSelected: { borderColor: '#1565c0', borderWidth: 2, backgroundColor: '#f0f7ff' },
  checkCircle: { position: 'absolute', top: 14, right: 14, zIndex: 5, width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#fff', backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  checkCircleOn: { backgroundColor: '#1565c0', borderColor: '#1565c0' },
  topBtn: { borderRadius: 7, paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center' },
  tabBtn: { borderRadius: 8, paddingVertical: 8, paddingHorizontal: 16, backgroundColor: '#e6eaf2' },
  tabBtnOn: { backgroundColor: '#1565c0' },
  tabText: { fontSize: 12.5, fontWeight: '800', color: '#5b6678' },
  tabTextOn: { color: '#fff' },
  search: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#dfe4ee', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, fontSize: 13, textAlign: 'right', marginBottom: 12, color: '#1a2540' },
  photo: { width: '100%', height: 200, borderRadius: 8, backgroundColor: '#eef1f6' },
  name: { fontSize: 13.5, fontWeight: '800', color: '#1a2540', textAlign: 'right', marginTop: 8 },
  meta: { fontSize: 11.5, color: '#5b6678', textAlign: 'right', marginTop: 2 },
  btn: { flex: 1, borderRadius: 7, paddingVertical: 8, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 11.5 },
});
