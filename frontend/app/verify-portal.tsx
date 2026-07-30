import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

// بوابة التحقق العامة على النطاق الرئيسي — بدون تسجيل دخول
export default function VerifyPortalPage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');

  const go = () => {
    const t = code.trim().split('token=').pop()?.split('&')[0]?.trim() || '';
    if (!t) { setErr('أدخل رمز التحقق المطبوع أسفل الوثيقة'); return; }
    router.push(`/verify-statement?token=${t}`);
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#f4f6fa', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <View style={{ backgroundColor: '#fff', borderRadius: 18, padding: 30, width: '100%', maxWidth: 460, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 16 }} data-testid="verify-portal-box">
        <Image source={require('../assets/images/icon.png')} style={{ width: 84, height: 84, borderRadius: 42 }} resizeMode="contain" />
        <Text style={{ fontSize: 20, fontWeight: '800', color: '#1a2540', marginTop: 12 }}>جامعة الأحقاف</Text>
        <Text style={{ fontSize: 13, color: '#5b6678', marginTop: 4 }}>بوابة التحقق من الوثائق الرسمية</Text>

        <View style={{ width: '100%', marginTop: 24, backgroundColor: '#f0f7f5', borderRadius: 12, padding: 16 }}>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Ionicons name="qr-code-outline" size={18} color="#00796b" />
            <Text style={{ fontSize: 13, fontWeight: '800', color: '#00796b' }}>الطريقة الأسرع</Text>
          </View>
          <Text style={{ fontSize: 12.5, color: '#3d4a5c', textAlign: 'right', lineHeight: 20 }}>
            امسح رمز QR المطبوع على الإفادة أو البطاقة بكاميرا جوالك — ستظهر نتيجة التحقق مباشرة.
          </Text>
        </View>

        <View style={{ width: '100%', marginTop: 14 }}>
          <Text style={{ fontSize: 12.5, fontWeight: '700', color: '#1a2540', textAlign: 'right', marginBottom: 6 }}>
            أو أدخل رمز التحقق يدوياً
          </Text>
          <TextInput
            value={code}
            onChangeText={(t) => { setCode(t); setErr(''); }}
            placeholder="الصق الرمز أو رابط التحقق هنا"
            placeholderTextColor="#9aa4b2"
            style={{ borderWidth: 1, borderColor: '#dde3ec', borderRadius: 10, padding: 12, textAlign: 'center', fontSize: 13, backgroundColor: '#fbfcfe', color: '#1a2540' }}
            onSubmitEditing={go}
            data-testid="portal-token-input"
          />
          {!!err && <Text style={{ fontSize: 11.5, color: '#c62828', textAlign: 'right', marginTop: 6 }}>{err}</Text>}
          <TouchableOpacity
            onPress={go}
            style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#00796b', borderRadius: 10, padding: 13, marginTop: 10 }}
            data-testid="portal-verify-btn"
          >
            <Ionicons name="shield-checkmark-outline" size={17} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>تحقق الآن</Text>
          </TouchableOpacity>
        </View>

        <Text style={{ fontSize: 10.5, color: '#9aa4b2', marginTop: 20, textAlign: 'center' }}>
          هذه البوابة مخصصة للتحقق من صحة الوثائق الصادرة عن جامعة الأحقاف فقط
        </Text>
      </View>
    </View>
  );
}
