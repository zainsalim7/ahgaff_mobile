import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';

// صفحة تحقق عامة من خطاب رسمي — بدون تسجيل دخول
export default function VerifyLetterPage() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<any>(null);
  const base = process.env.EXPO_PUBLIC_BACKEND_URL || (typeof window !== 'undefined' ? window.location.origin : '');

  useEffect(() => {
    const run = async () => {
      try { setResult((await axios.get(`${base}/api/hr/verify/letter/${token}`)).data); }
      catch { setResult({ valid: false, message: 'تعذر الاتصال بخادم التحقق — حاول مجدداً' }); }
      finally { setLoading(false); }
    };
    if (token) run(); else { setResult({ valid: false, message: 'رمز تحقق مفقود' }); setLoading(false); }
  }, [token]);

  const ok = !!result?.valid;
  const rows = ok ? [['الرقم المرجعي', result.ref_no], ['نوع الخطاب', `${result.type_label}${result.language === 'en' ? ` / ${result.type_label_en}` : ''}`], ['الموظف', `${result.employee_name} (${result.employee_no})`], ['الوظيفة', result.job_title], ['الوحدة', result.org_unit_name], ['موجّه إلى', result.addressed_to || 'إلى من يهمه الأمر'], ['تاريخ الإصدار', result.issue_date], ['اعتمده', result.approved_by]].filter(([, v]) => v) : [];
  return (
    <View style={{ flex: 1, backgroundColor: '#f4f6fa', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 460, alignItems: 'center' }} testID="verify-letter-card">
        <Text style={{ fontSize: 18, fontWeight: '800', color: '#1a2540', marginBottom: 4 }}>جامعة الأحقاف</Text>
        <Text style={{ fontSize: 12, color: '#8a95a8', marginBottom: 18 }}>التحقق من خطاب رسمي — شؤون الموظفين</Text>
        {loading ? <ActivityIndicator size="large" color="#1565c0" /> : (<>
          <Ionicons name={ok ? 'shield-checkmark' : 'close-circle'} size={56} color={ok ? '#2e7d32' : '#c62828'} />
          <Text style={{ fontSize: 15, fontWeight: '800', color: ok ? '#2e7d32' : '#c62828', marginTop: 10, textAlign: 'center' }} testID={ok ? 'verify-valid' : 'verify-invalid'}>{result?.message}</Text>
          {rows.length > 0 && (
            <View style={{ marginTop: 16, width: '100%', backgroundColor: '#f8faf9', borderRadius: 10, padding: 14, gap: 8 }}>
              {rows.map(([k, v]) => <View key={k as string} style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', gap: 10 }}><Text style={{ fontSize: 12.5, color: '#5b6678', fontWeight: '700' }}>{k}</Text><Text style={{ fontSize: 12.5, color: '#1a2540', flex: 1, textAlign: 'left' }}>{String(v ?? '—')}</Text></View>)}
            </View>
          )}
        </>)}
      </View>
    </View>
  );
}
