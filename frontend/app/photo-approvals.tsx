import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Image, RefreshControl } from 'react-native';
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

  if (loading) {
    return <SafeAreaView style={styles.container}><ActivityIndicator size="large" color="#00796b" style={{ marginTop: 60 }} /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={{ padding: 14 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} />}
      >
        <Text style={styles.title}>🖼️ صور الطلاب المعلقة ({items.length})</Text>
        <Text style={styles.hint}>صور رفعها الطلاب من تطبيقهم — تظهر على البطاقة الرقمية بعد اعتمادها فقط.</Text>
        {!!msg && <Text style={styles.msg} data-testid="approvals-msg">{msg}</Text>}
        {items.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="checkmark-done-circle-outline" size={44} color="#a5d6a7" />
            <Text style={styles.emptyText}>لا توجد صور بانتظار الاعتماد</Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {items.map((s) => (
              <View key={s.id} style={styles.cardBox} data-testid={`pending-photo-${s.id}`}>
                <Image source={{ uri: fileUrl(s.pending_photo_path) }} style={styles.photo} resizeMode="cover" />
                <Text style={styles.name}>{s.full_name}</Text>
                <Text style={styles.meta}>قيد: {s.student_id} · م{s.level}</Text>
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
              </View>
            ))}
          </View>
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
  photo: { width: '100%', height: 200, borderRadius: 8, backgroundColor: '#eef1f6' },
  name: { fontSize: 13.5, fontWeight: '800', color: '#1a2540', textAlign: 'right', marginTop: 8 },
  meta: { fontSize: 11.5, color: '#5b6678', textAlign: 'right', marginTop: 2 },
  btn: { flex: 1, borderRadius: 7, paddingVertical: 8, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 11.5 },
});
