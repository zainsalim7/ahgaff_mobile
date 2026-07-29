import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, Image } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';

// صفحة تحقق عامة من البطاقة الرقمية للطالب — بدون تسجيل دخول
export default function VerifyCardPage() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<any>(null);
  const base = process.env.EXPO_PUBLIC_BACKEND_URL || (typeof window !== 'undefined' ? window.location.origin : '');

  useEffect(() => {
    const run = async () => {
      try {
        const res = await axios.get(`${base}/api/verify/card/${token}`);
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
      <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 460, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 16 }} data-testid="verify-card-box">
        <Text style={{ fontSize: 18, fontWeight: '800', color: '#1a2540', marginBottom: 4 }}>جامعة الأحقاف</Text>
        <Text style={{ fontSize: 12, color: '#8a95a8', marginBottom: 18 }}>التحقق من بطاقة طالب</Text>
        {loading ? (
          <ActivityIndicator size="large" color="#1565c0" />
        ) : (
          <>
            {result?.has_photo && (
              <Image source={{ uri: `${base}/api/public/card-photo/${token}` }} style={{ width: 110, height: 140, borderRadius: 10, marginBottom: 12, borderWidth: 2, borderColor: result?.valid ? '#2e7d32' : '#c62828' }} resizeMode="cover" />
            )}
            <Ionicons name={result?.valid ? 'shield-checkmark' : 'close-circle'} size={50} color={result?.valid ? '#2e7d32' : '#c62828'} />
            <Text style={{ fontSize: 15, fontWeight: '800', color: result?.valid ? '#2e7d32' : '#c62828', marginTop: 8, textAlign: 'center' }} data-testid={result?.valid ? 'verify-card-valid' : 'verify-card-invalid'}>
              {result?.message}
            </Text>
            {!!result?.student_name && (
              <View style={{ marginTop: 16, width: '100%', backgroundColor: '#f8faf9', borderRadius: 10, padding: 14, gap: 8 }}>
                {[
                  ['اسم الطالب', result.student_name],
                  ['رقم القيد', result.enrollment_no],
                  ['الكلية', result.faculty_name],
                  ['التخصص', result.department_name],
                  ['المستوى', String(result.level || '')],
                  ['الجنسية', result.nationality],
                  ['العام الجامعي', result.academic_year],
                ].map(([k, v]) => (
                  <View key={k as string} style={{ flexDirection: 'row-reverse', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 12.5, color: '#5b6678', fontWeight: '700' }}>{k}</Text>
                    <Text style={{ fontSize: 12.5, color: '#1a2540' }}>{v}</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </View>
    </View>
  );
}
