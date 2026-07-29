import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, ActivityIndicator, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import api from '../src/services/api';
import { LoadingScreen } from '../src/components/LoadingScreen';

const THEME: any = {
  green: { band: '#1b5e20', bg: '#fff', text: '#1a2540', bandText: '#fff', accent: '#1b5e20', muted: '#5b6678', strip: '#e8f5e9', stripText: '#1b5e20' },
  dark: { band: '#071417', bg: '#0f2027', text: '#fff', bandText: '#fff', accent: '#4db6ac', muted: '#b0bec5', strip: '#071417', stripText: '#4db6ac' },
  horizontal: { band: '#1b5e20', bg: '#fff', text: '#1a2540', bandText: '#fff', accent: '#1b5e20', muted: '#5b6678', strip: '#e8f5e9', stripText: '#1b5e20' },
};

export default function StudentCardScreen() {
  const [card, setCard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const t = await AsyncStorage.getItem('token');
      setToken(t || '');
      const res = await api.get('/students/me/card');
      setCard(res.data);
    } catch (error) {
      console.error('Error fetching card:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const fileUrl = (path: string) => `${api.defaults.baseURL}/files/${path}?auth=${token}`;

  const uploadPhoto = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [3, 4],
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.[0]) return;
      setBusy(true);
      setMsg('');
      const asset = result.assets[0];
      const fd = new FormData();
      if (Platform.OS === 'web') {
        const blob = await (await fetch(asset.uri)).blob();
        fd.append('file', new File([blob], 'photo.jpg', { type: blob.type || 'image/jpeg' }));
      } else {
        fd.append('file', { uri: asset.uri, name: 'photo.jpg', type: 'image/jpeg' } as any);
      }
      await api.post('/students/me/photo', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setMsg('✅ تم رفع صورتك — ستظهر على البطاقة بعد اعتماد المسجل');
      fetchData();
    } catch (e: any) {
      setMsg(e?.response?.data?.detail || 'فشل رفع الصورة');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingScreen />;

  if (!card) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={56} color="#c62828" />
          <Text style={styles.errorText}>لم يتم العثور على بيانات الطالب</Text>
        </View>
      </SafeAreaView>
    );
  }

  const t = THEME[card.template] || THEME.green;
  const levelAr = ['', 'الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن'][card.level] || String(card.level);
  const rows = [
    ['رقم القيد', card.enrollment_no],
    ...(card.reference_number ? [['الرقم المرجعي', card.reference_number]] : []),
    ['التخصص', card.department_name],
    ['المستوى', `المستوى ${levelAr}`],
    ['الجنسية', card.nationality],
  ];

  return (
    <SafeAreaView style={styles.container} edges={['bottom']} data-testid="student-card-screen">
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* ===== البطاقة الرقمية ===== */}
        <View style={[styles.card, { backgroundColor: t.bg }]} data-testid="digital-card">
          <View style={{ backgroundColor: t.band, alignItems: 'center', paddingVertical: 14 }}>
            <Text style={{ color: t.bandText, fontSize: 18, fontWeight: '800' }}>جامعة الأحقاف</Text>
            <Text style={{ color: t.bandText, fontSize: 12.5, fontWeight: '600', marginTop: 2 }}>{card.faculty_name}</Text>
            <Text style={{ color: t.bandText, fontSize: 13, fontWeight: '800', marginTop: 4 }}>بطاقة طالب</Text>
          </View>
          <View style={{ alignItems: 'center', paddingTop: 16 }}>
            {card.photo_path ? (
              <Image source={{ uri: fileUrl(card.photo_path) }} style={{ width: 130, height: 160, borderWidth: 3, borderColor: t.accent, backgroundColor: '#fff' }} resizeMode="cover" data-testid="card-photo" />
            ) : (
              <View style={{ width: 130, height: 160, backgroundColor: '#e6eaf2', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="person" size={44} color="#9aa4b2" />
                <Text style={{ fontSize: 10, color: '#7b8794' }}>لا توجد صورة</Text>
              </View>
            )}
            <Text style={{ fontSize: 18, fontWeight: '800', color: t.text, marginTop: 10, textAlign: 'center', paddingHorizontal: 12 }} data-testid="card-student-name">
              {card.student_name}
            </Text>
            <View style={{ width: '100%', paddingHorizontal: 20, marginTop: 10 }}>
              {rows.map(([k, v]) => (
                <View key={k} style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', marginBottom: 7 }}>
                  <Text style={{ fontSize: 12, color: t.muted, fontWeight: '700' }}>{k}:</Text>
                  <Text style={{ fontSize: 13, color: t.text, fontWeight: '700' }}>{v}</Text>
                </View>
              ))}
            </View>
            <View style={{ backgroundColor: '#fff', padding: 8, borderRadius: 8, marginTop: 6 }}>
              <QRCode value={card.verify_url} size={130} />
            </View>
            <Text style={{ fontSize: 11, color: t.muted, marginTop: 6, marginBottom: 10 }}>
              يُستخدم للتحقق ولتسجيل الحضور
            </Text>
          </View>
          <View style={{ backgroundColor: t.strip, paddingVertical: 7 }}>
            <Text style={{ textAlign: 'center', color: t.stripText, fontSize: 12.5, fontWeight: '800' }} data-testid="card-validity">
              صالحة للعام الجامعي {card.academic_year}
            </Text>
          </View>
        </View>

        {/* صورة معلقة */}
        {!!card.pending_photo_path && (
          <View style={styles.pendingBox} data-testid="pending-photo-note">
            <Ionicons name="time-outline" size={18} color="#8d6e00" />
            <Text style={styles.pendingText}>صورتك المرفوعة بانتظار اعتماد المسجل</Text>
          </View>
        )}

        {!!msg && <Text style={styles.msg} data-testid="upload-msg">{msg}</Text>}

        <TouchableOpacity onPress={uploadPhoto} disabled={busy} style={[styles.uploadBtn, busy && { opacity: 0.6 }]} data-testid="upload-my-photo-btn">
          {busy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="camera" size={18} color="#fff" />}
          <Text style={styles.uploadBtnText}>{card.photo_path ? 'تحديث صورتي' : 'رفع صورتي للبطاقة'}</Text>
        </TouchableOpacity>
        <Text style={styles.uploadHint}>تُعتمد الصورة من مسجل الكلية قبل ظهورها على البطاقة</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5' },
  scrollContent: { padding: 20, alignItems: 'center', paddingBottom: 40 },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { fontSize: 16, color: '#c62828', marginTop: 12 },
  card: {
    borderRadius: 18, width: '100%', maxWidth: 360, overflow: 'hidden',
    elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.14, shadowRadius: 12,
  },
  pendingBox: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 6, backgroundColor: '#fff8e1',
    borderRadius: 10, padding: 10, marginTop: 14, borderWidth: 1, borderColor: '#ffe082', maxWidth: 360, width: '100%',
  },
  pendingText: { fontSize: 12.5, fontWeight: '700', color: '#8d6e00', textAlign: 'right', flex: 1 },
  msg: { marginTop: 12, fontSize: 12.5, fontWeight: '700', color: '#2e7d32', textAlign: 'center' },
  uploadBtn: {
    flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#00796b', borderRadius: 12, paddingVertical: 13, marginTop: 16, width: '100%', maxWidth: 360,
  },
  uploadBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  uploadHint: { fontSize: 11, color: '#8a95a8', marginTop: 8, textAlign: 'center' },
});
