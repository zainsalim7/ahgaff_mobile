import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, Image } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';

// صفحة تحقق عامة من البطاقة الوظيفية/الأكاديمية — بدون تسجيل دخول
export default function VerifyEmployeePage() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<any>(null);
  const base = process.env.EXPO_PUBLIC_BACKEND_URL || (typeof window !== 'undefined' ? window.location.origin : '');

  useEffect(() => {
    const run = async () => {
      try { setResult((await axios.get(`${base}/api/hr/verify/employee/${token}`)).data); }
      catch { setResult({ valid: false, message: 'تعذر الاتصال بخادم التحقق — حاول مجدداً' }); }
      finally { setLoading(false); }
    };
    if (token) run(); else { setResult({ valid: false, message: 'رمز تحقق مفقود' }); setLoading(false); }
  }, [token]);

  const rows = result?.full_name ? [['الاسم', result.full_name], ['الرقم الوظيفي', result.number], [result.kind === 'academic' ? 'الرتبة الأكاديمية' : 'المسمى الوظيفي', result.title], ['الكلية', result.faculty_name], ['القسم', result.department_name], ['الوحدة', result.org_unit_name], ['الحالة', result.status_label], ['صالحة حتى', result.valid_until]].filter(([, v]) => v) : [];
  const ok = !!result?.valid;
  return (
    <View style={{ flex: 1, backgroundColor: '#f4f6fa', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 460, alignItems: 'center' }} testID="verify-employee-card">
        <Text style={{ fontSize: 18, fontWeight: '800', color: '#1a2540', marginBottom: 4 }}>جامعة الأحقاف</Text>
        <Text style={{ fontSize: 12, color: '#8a95a8', marginBottom: 18 }}>التحقق من {result?.kind_label || 'البطاقة الوظيفية / الأكاديمية'} — شؤون الموظفين</Text>
        {loading ? <ActivityIndicator size="large" color="#1565c0" /> : (<>
          {result?.has_photo && token && <Image source={{ uri: `${base}/api/hr/public/employee-photo/${token}` }} style={{ width: 96, height: 120, borderRadius: 10, marginBottom: 12, backgroundColor: '#eef2f7' }} testID="verify-employee-photo" />}
          <Ionicons name={ok ? 'shield-checkmark' : 'close-circle'} size={56} color={ok ? '#2e7d32' : '#c62828'} />
          <Text style={{ fontSize: 15, fontWeight: '800', color: ok ? '#2e7d32' : '#c62828', marginTop: 10, textAlign: 'center' }} testID={ok ? 'verify-valid' : 'verify-invalid'}>{result?.message}</Text>
          {rows.length > 0 && (
            <View style={{ marginTop: 16, width: '100%', backgroundColor: '#f8faf9', borderRadius: 10, padding: 14, gap: 8 }}>
              {rows.map(([k, v]) => <View key={k as string} style={{ flexDirection: 'row-reverse', justifyContent: 'space-between' }}><Text style={{ fontSize: 12.5, color: '#5b6678', fontWeight: '700' }}>{k}</Text><Text style={{ fontSize: 12.5, color: '#1a2540' }}>{String(v ?? '—')}</Text></View>)}
            </View>
          )}
        </>)}
      </View>
    </View>
  );
}
