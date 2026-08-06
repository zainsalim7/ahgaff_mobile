import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, ActivityIndicator, Image,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import api from '../src/services/api';
import { LoadingScreen } from '../src/components/LoadingScreen';
import { useAuthStore } from '../src/store/authStore';

const THEME: any = {
  green: { band: '#1b5e20', bg: '#fff', text: '#1a2540', bandText: '#fff', accent: '#1b5e20', muted: '#5b6678', strip: '#e8f5e9', stripText: '#1b5e20' },
  dark: { band: '#071417', bg: '#0f2027', text: '#fff', bandText: '#fff', accent: '#4db6ac', muted: '#b0bec5', strip: '#071417', stripText: '#4db6ac' },
  official: { band: '#1b5e20', bg: '#fff', text: '#1a2540', bandText: '#fff', accent: '#1b5e20', muted: '#607d66', strip: '#e8f5e9', stripText: '#1b5e20' },
};

export default function StudentCardScreen() {
  const { studentId } = useLocalSearchParams<{ studentId?: string }>();
  const router = useRouter();
  const [card, setCard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  const token = useAuthStore.getState().token;
  const fileUrl = (path: string) => `${api.defaults.baseURL}/files/${path}?auth=${token}`;

  const fetchCard = useCallback(async () => {
    try {
      const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
      const res = await api.get(`/students/${studentId}/card`, { params: { base_url: baseUrl } });
      setCard(res.data);
    } catch (e: any) {
      setMsg(e?.response?.data?.detail || 'فشل تحميل البطاقة');
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => { if (studentId) fetchCard(); }, [studentId, fetchCard]);

  const download = async (fmt: 'png' | 'pdf') => {
    setBusy(fmt);
    try {
      const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
      const res = await api.get(`/students/${studentId}/card/download`, {
        params: { fmt, base_url: baseUrl }, responseType: 'blob',
      });
      if (Platform.OS === 'web') {
        const url = window.URL.createObjectURL(new Blob([res.data]));
        const a = document.createElement('a');
        a.href = url;
        a.download = `card_${card?.enrollment_no || 'student'}.${fmt}`;
        a.click();
        window.URL.revokeObjectURL(url);
      }
    } catch {
      setMsg('فشل التنزيل');
    } finally {
      setBusy('');
    }
  };

  const uploadPhoto = () => {
    if (Platform.OS !== 'web') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (!file) return;
      setBusy('photo');
      try {
        const fd = new FormData();
        fd.append('file', file);
        await api.post(`/students/${studentId}/photo`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        setMsg('✅ تم حفظ صورة الطالب');
        fetchCard();
      } catch (err: any) {
        setMsg(err?.response?.data?.detail || 'فشل رفع الصورة');
      } finally {
        setBusy('');
      }
    };
    input.click();
  };

  const decidePending = async (action: 'approve' | 'reject') => {
    setBusy(action);
    try {
      await api.post(`/students/${studentId}/photo/${action}`);
      setMsg(action === 'approve' ? '✅ اعتُمدت صورة الطالب' : 'رُفضت الصورة المعلقة');
      fetchCard();
    } catch (e: any) {
      setMsg(e?.response?.data?.detail || 'فشل الإجراء');
    } finally {
      setBusy('');
    }
  };

  if (loading) return <LoadingScreen />;
  if (!card) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={{ textAlign: 'center', marginTop: 60, color: '#c62828', fontWeight: '700' }}>{msg || 'تعذر تحميل البطاقة'}</Text>
      </SafeAreaView>
    );
  }

  const horizontal = card.template === 'horizontal';
  const t = THEME[card.template] || THEME.green;
  const levelAr = ['', 'الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن'][card.level] || String(card.level);
  const rows = [
    ['رقم القيد', card.enrollment_no],
    ['التخصص', card.department_name],
    ['المستوى', `المستوى ${levelAr}`],
    ...((card.section || '').trim() ? [['الشعبة', card.section.trim()]] : []),
    ['الجنسية', card.nationality],
  ];

  const Photo = ({ w, h }: { w: number; h: number }) => (
    card.photo_path ? (
      <Image source={{ uri: fileUrl(card.photo_path) }} style={{ width: w, height: h, borderWidth: 3, borderColor: t.accent, backgroundColor: '#fff' }} resizeMode="cover" data-testid="card-photo" />
    ) : (
      <View style={{ width: w, height: h, backgroundColor: '#e6eaf2', alignItems: 'center', justifyContent: 'center' }} data-testid="card-no-photo">
        <Ionicons name="person" size={w / 3} color="#9aa4b2" />
        <Text style={{ fontSize: 10, color: '#7b8794' }}>لا توجد صورة</Text>
      </View>
    )
  );

  const InfoRows = ({ align }: { align: 'center' | 'right' }) => (
    <View style={{ width: '100%', paddingHorizontal: 18, marginTop: 8 }}>
      {rows.map(([k, v]) => (
        <View key={k} style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', marginBottom: 6 }}>
          <Text style={{ fontSize: 11.5, color: t.muted, fontWeight: '700' }}>{k}:</Text>
          <Text style={{ fontSize: 12.5, color: t.text, fontWeight: '700' }}>{v}</Text>
        </View>
      ))}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: 16, alignItems: 'center', paddingBottom: 40 }}>
        {/* ===== البطاقة الرقمية ===== */}
        {card.template === 'official' ? (
          <View style={[styles.card, { width: 330, backgroundColor: '#fff', borderRightWidth: 7, borderRightColor: '#1b5e20', borderLeftWidth: 3, borderLeftColor: '#e8f5e9' }]} data-testid="digital-card">
            <Image source={require('../assets/images/icon.png')} style={{ position: 'absolute', top: 270, left: 45, width: 240, height: 240, opacity: 0.07 }} resizeMode="contain" />
            <View style={{ alignItems: 'center', paddingTop: 16 }}>
              <View style={{ width: 74, height: 74, borderRadius: 37, borderWidth: 3, borderColor: '#1b5e20', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' }}>
                <Image source={require('../assets/images/icon.png')} style={{ width: 60, height: 60, borderRadius: 30 }} resizeMode="contain" />
              </View>
              <Text style={{ color: '#1b5e20', fontSize: 19, fontWeight: '800', marginTop: 6 }}>جامعة الأحقاف</Text>
              <Text style={{ color: '#607d66', fontSize: 9.5, fontWeight: '700', letterSpacing: 1 }}>AL-AHGAFF UNIVERSITY</Text>
              <View style={{ backgroundColor: '#e8f5e9', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 4, marginTop: 8 }}>
                <Text style={{ color: '#1b5e20', fontSize: 11.5, fontWeight: '800' }}>{card.faculty_name}</Text>
              </View>
              <View style={{ backgroundColor: '#1b5e20', borderRadius: 8, paddingHorizontal: 26, paddingVertical: 5, marginTop: 8 }}>
                <Text style={{ color: '#fff', fontSize: 12.5, fontWeight: '800' }}>بطاقة طالب</Text>
              </View>
              <View style={{ backgroundColor: '#e8f5e9', borderRadius: 10, padding: 6, marginTop: 12 }}>
                <View style={{ borderWidth: 3, borderColor: '#1b5e20' }}>
                  <Photo w={112} h={140} />
                </View>
              </View>
              <Text style={{ fontSize: 16.5, fontWeight: '800', color: '#1b5e20', marginTop: 8, textAlign: 'center', paddingHorizontal: 10 }} data-testid="card-student-name">{card.student_name}</Text>
              <View style={{ height: 2, backgroundColor: '#e8f5e9', width: '70%', marginTop: 6 }} />
              <View style={{ width: '100%', paddingHorizontal: 18, marginTop: 8 }}>
                {rows.map(([k, v]) => (
                  <View key={k} style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', marginBottom: 6 }}>
                    <Text style={{ fontSize: 11, color: '#2e7d32', fontWeight: '800' }}>{k}:</Text>
                    <Text style={{ fontSize: 12, color: '#1a2540', fontWeight: '700' }}>{v}</Text>
                  </View>
                ))}
              </View>
              <View style={{ flexDirection: 'row-reverse', width: '100%', paddingHorizontal: 18, alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                <Text style={{ fontSize: 10, color: '#607d66', width: 110, textAlign: 'right' }}>امسح الرمز للتحقق من صحة البطاقة</Text>
                <View style={{ borderWidth: 2, borderColor: '#e8f5e9', borderRadius: 8, padding: 5, backgroundColor: '#fff' }}>
                  <QRCode value={card.verify_url} size={76} />
                </View>
              </View>
            </View>
            <View style={{ borderTopWidth: 2, borderTopColor: '#1b5e20', backgroundColor: '#e8f5e9', paddingVertical: 6, marginTop: 10 }}>
              <Text style={{ textAlign: 'center', color: '#1b5e20', fontSize: 12, fontWeight: '800' }} data-testid="card-validity">
                صالحة للعام الجامعي {card.academic_year}
              </Text>
            </View>
          </View>
        ) : !horizontal ? (
          <View style={[styles.card, { width: 330, backgroundColor: t.bg }]} data-testid="digital-card">
            <Image source={require('../assets/images/icon.png')} style={{ position: 'absolute', top: 250, left: 45, width: 240, height: 240, opacity: 0.07 }} resizeMode="contain" />
            <View style={{ backgroundColor: t.band, alignItems: 'center', paddingVertical: 12 }}>
              <Image source={require('../assets/images/icon.png')} style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: '#fff' }} resizeMode="contain" />
              <Text style={{ color: t.bandText, fontSize: 17, fontWeight: '800', marginTop: 4 }}>جامعة الأحقاف</Text>
              <Text style={{ color: t.bandText, fontSize: 12, fontWeight: '600' }}>{card.faculty_name}</Text>
              <Text style={{ color: t.bandText, fontSize: 12.5, fontWeight: '800', marginTop: 2 }}>بطاقة طالب</Text>
            </View>
            <View style={{ alignItems: 'center', paddingTop: 14 }}>
              <Photo w={130} h={160} />
              <Text style={{ fontSize: 17, fontWeight: '800', color: t.text, marginTop: 8, textAlign: 'center', paddingHorizontal: 10 }} data-testid="card-student-name">{card.student_name}</Text>
              <InfoRows align="right" />
              <View style={{ flexDirection: 'row-reverse', width: '100%', paddingHorizontal: 18, alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                <Text style={{ fontSize: 10, color: t.muted, width: 110, textAlign: 'right' }}>امسح الرمز للتحقق من صحة البطاقة</Text>
                <View style={{ backgroundColor: '#fff', padding: 5 }}>
                  <QRCode value={card.verify_url} size={80} />
                </View>
              </View>
            </View>
            <View style={{ backgroundColor: t.strip, paddingVertical: 6, marginTop: 10 }}>
              <Text style={{ textAlign: 'center', color: t.stripText, fontSize: 12, fontWeight: '800' }} data-testid="card-validity">
                صالحة للعام الجامعي {card.academic_year}
              </Text>
            </View>
          </View>
        ) : (
          <View style={[styles.card, { width: 560, maxWidth: '100%', backgroundColor: '#fff' }]} data-testid="digital-card">
            <Image source={require('../assets/images/icon.png')} style={{ position: 'absolute', top: 55, left: 170, width: 220, height: 220, opacity: 0.07 }} resizeMode="contain" />
            <View style={{ backgroundColor: THEME.green.band, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 8 }}>
              <View>
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800', textAlign: 'right' }}>جامعة الأحقاف</Text>
                <Text style={{ color: '#fff', fontSize: 11, textAlign: 'right' }}>{card.faculty_name}</Text>
              </View>
              <Image source={require('../assets/images/icon.png')} style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: '#fff' }} resizeMode="contain" />
              <View>
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>AL-AHGAFF UNIVERSITY</Text>
                <Text style={{ color: '#fff', fontSize: 10 }}>STUDENT ID CARD</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row-reverse', padding: 14, gap: 12 }}>
              <Photo w={120} h={150} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: '800', color: '#1a2540', textAlign: 'right' }} data-testid="card-student-name">{card.student_name}</Text>
                {rows.map(([k, v]) => (
                  <View key={k} style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', marginTop: 5 }}>
                    <Text style={{ fontSize: 11, color: '#5b6678', fontWeight: '700' }}>{k}:</Text>
                    <Text style={{ fontSize: 12, color: '#1a2540', fontWeight: '700' }}>{v}</Text>
                  </View>
                ))}
              </View>
              <View style={{ justifyContent: 'flex-end', alignItems: 'center', marginRight: 8 }}>
                <QRCode value={card.verify_url} size={74} />
                <Text style={{ fontSize: 9, color: '#5b6678', marginTop: 4 }}>امسح للتحقق</Text>
              </View>
            </View>
            <View style={{ backgroundColor: '#e8f5e9', paddingVertical: 5 }}>
              <Text style={{ textAlign: 'center', color: '#1b5e20', fontSize: 11.5, fontWeight: '800' }} data-testid="card-validity">
                صالحة للعام الجامعي {card.academic_year}
              </Text>
            </View>
          </View>
        )}

        {/* ===== صورة معلقة بانتظار الاعتماد ===== */}
        {!!card.pending_photo_path && (
          <View style={styles.pendingBox} data-testid="pending-photo-box">
            <Text style={styles.pendingTitle}>🕓 صورة معلقة رفعها الطالب — بانتظار الاعتماد</Text>
            <Image source={{ uri: fileUrl(card.pending_photo_path) }} style={{ width: 110, height: 140, borderRadius: 8, alignSelf: 'center', marginVertical: 8 }} resizeMode="cover" />
            <View style={{ flexDirection: 'row-reverse', gap: 8 }}>
              <TouchableOpacity onPress={() => decidePending('approve')} disabled={!!busy} style={[styles.smallBtn, { backgroundColor: '#2e7d32' }]} data-testid="approve-photo-btn">
                <Text style={styles.smallBtnText}>اعتماد</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => decidePending('reject')} disabled={!!busy} style={[styles.smallBtn, { backgroundColor: '#c62828' }]} data-testid="reject-photo-btn">
                <Text style={styles.smallBtnText}>رفض</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {!!msg && <Text style={styles.msg} data-testid="card-msg">{msg}</Text>}

        {/* ===== الإجراءات ===== */}
        <View style={styles.actionsRow}>
          <TouchableOpacity onPress={() => download('png')} disabled={!!busy} style={styles.actionBtn} data-testid="download-png-btn">
            {busy === 'png' ? <ActivityIndicator size="small" color="#00796b" /> : <Ionicons name="image-outline" size={16} color="#00796b" />}
            <Text style={styles.actionText}>تنزيل صورة</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => download('pdf')} disabled={!!busy} style={styles.actionBtn} data-testid="download-pdf-btn">
            {busy === 'pdf' ? <ActivityIndicator size="small" color="#00796b" /> : <Ionicons name="document-outline" size={16} color="#00796b" />}
            <Text style={styles.actionText}>تنزيل PDF</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={uploadPhoto} disabled={!!busy} style={styles.actionBtn} data-testid="upload-photo-btn">
            {busy === 'photo' ? <ActivityIndicator size="small" color="#00796b" /> : <Ionicons name="camera-outline" size={16} color="#00796b" />}
            <Text style={styles.actionText}>{card.photo_path ? 'تغيير الصورة' : 'رفع صورة'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push(`/card-settings?facultyId=${card.faculty_id}`)} style={styles.actionBtn} data-testid="card-settings-link">
            <Ionicons name="color-palette-outline" size={16} color="#1565c0" />
            <Text style={[styles.actionText, { color: '#1565c0' }]}>تصميم البطاقة</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f6fb' },
  card: { borderRadius: 16, overflow: 'hidden', elevation: 4, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  pendingBox: { backgroundColor: '#fff8e1', borderRadius: 12, padding: 14, marginTop: 16, width: '100%', maxWidth: 560, borderWidth: 1, borderColor: '#ffe082' },
  pendingTitle: { fontSize: 13, fontWeight: '800', color: '#8d6e00', textAlign: 'right' },
  smallBtn: { flex: 1, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  smallBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  msg: { marginTop: 12, fontSize: 12.5, fontWeight: '700', color: '#2e7d32', textAlign: 'center' },
  actionsRow: { flexDirection: 'row-reverse', gap: 8, marginTop: 18, flexWrap: 'wrap', justifyContent: 'center' },
  actionBtn: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: '#d5e8e5', backgroundColor: '#fff', borderRadius: 8, paddingVertical: 9, paddingHorizontal: 14 },
  actionText: { fontSize: 12.5, fontWeight: '700', color: '#00796b' },
});
