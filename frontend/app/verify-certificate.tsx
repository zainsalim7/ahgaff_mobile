import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';

// صفحة تحقق عامة من صحة شهادة التخرج — بدون تسجيل دخول
export default function VerifyCertificatePage() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    const run = async () => {
      try {
        const base = process.env.EXPO_PUBLIC_BACKEND_URL || (typeof window !== 'undefined' ? window.location.origin : '');
        const res = await axios.get(`${base}/api/verify/certificate/${token}`);
        setResult(res.data);
      } catch {
        setResult({ valid: false, message: 'تعذر الاتصال بخادم التحقق — حاول مجدداً' });
      } finally {
        setLoading(false);
      }
    };
    if (token) run();
    else { setResult({ valid: false, message: 'رمز تحقق مفقود' }); setLoading(false); }
  }, [token]);

  return (
    <View style={{ flex: 1, backgroundColor: '#f4f6fa', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 460, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 16 }} testID="verify-certificate-card">
        <Text style={{ fontSize: 18, fontWeight: '800', color: '#1a2540', marginBottom: 4 }}>جامعة الأحقاف</Text>
        <Text style={{ fontSize: 12, color: '#8a95a8', marginBottom: 18 }}>التحقق من صحة شهادة تخرج</Text>
        {loading ? (
          <ActivityIndicator size="large" color="#1565c0" />
        ) : result?.valid ? (
          <>
            <Ionicons name="ribbon" size={56} color="#2e7d32" />
            <Text style={{ fontSize: 15, fontWeight: '800', color: '#2e7d32', marginTop: 10, textAlign: 'center' }} testID="verify-valid">
              {result.message}
            </Text>
            <View style={{ marginTop: 16, width: '100%', backgroundColor: '#f8faf9', borderRadius: 10, padding: 14, gap: 8 }}>
              {[
                ['رقم الشهادة', result.number],
                ['اسم الخريج', result.student_name],
                ['الكلية', result.faculty_name],
                ['التخصص', result.department_name],
                ['التقدير العام', result.grade],
                ['تاريخ المنح', result.graduation_date],
                ['التاريخ الهجري', result.hijri_date],
                ['تاريخ الإصدار', result.issued_at],
              ].map(([k, v]) => (
                <View key={k as string} style={{ flexDirection: 'row-reverse', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 12.5, color: '#5b6678', fontWeight: '700' }}>{k}</Text>
                  <Text style={{ fontSize: 12.5, color: '#1a2540' }}>{v}</Text>
                </View>
              ))}
            </View>
          </>
        ) : (
          <>
            <Ionicons name="close-circle" size={56} color="#c62828" />
            <Text style={{ fontSize: 15, fontWeight: '800', color: '#c62828', marginTop: 10, textAlign: 'center' }} testID="verify-invalid">
              {result?.message}
            </Text>
            {!!result?.number && <Text style={{ fontSize: 12.5, color: '#5b6678', marginTop: 8 }}>رقم الشهادة: {result.number}</Text>}
          </>
        )}
      </View>
    </View>
  );
}
