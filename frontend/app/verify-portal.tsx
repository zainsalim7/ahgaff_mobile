import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, Image, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

// بوابة التحقق العامة على النطاق الرئيسي — بدون تسجيل دخول
const UNIVERSITY_SITE = 'https://ahgaff.edu';

export default function VerifyPortalPage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [scanning, setScanning] = useState(false);
  const [camErr, setCamErr] = useState('');
  const videoRef = useRef<any>(null);
  const streamRef = useRef<any>(null);
  const rafRef = useRef<any>(null);

  const openUniversity = () => {
    if (Platform.OS === 'web') window.open(UNIVERSITY_SITE, '_blank');
  };

  const goToken = useCallback((raw: string) => {
    const t = raw.trim().split('token=').pop()?.split('&')[0]?.trim() || '';
    if (!t) return false;
    const isCard = raw.includes('verify-card');
    router.push(`${isCard ? '/verify-card' : '/verify-statement'}?token=${t}`);
    return true;
  }, [router]);

  const go = () => {
    if (!code.trim()) { setErr('أدخل رمز التحقق المطبوع أسفل الوثيقة'); return; }
    if (!goToken(code)) setErr('رمز غير صالح');
  };

  const stopScan = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t: any) => t.stop());
      streamRef.current = null;
    }
    setScanning(false);
  }, []);

  useEffect(() => () => stopScan(), [stopScan]);

  const startScan = async () => {
    if (Platform.OS !== 'web') return;
    setCamErr('');
    setScanning(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      const video = videoRef.current;
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      await video.play();
      const jsQR = (await import('jsqr')).default;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      const tick = () => {
        if (!streamRef.current) return;
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const qr = jsQR(img.data, img.width, img.height);
          if (qr?.data && qr.data.includes('token=')) {
            stopScan();
            goToken(qr.data);
            return;
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (e: any) {
      stopScan();
      setCamErr(e?.name === 'NotAllowedError'
        ? 'رُفض إذن الكاميرا — اسمح للموقع باستخدام الكاميرا من إعدادات المتصفح'
        : 'تعذر تشغيل الكاميرا على هذا الجهاز');
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#f4f6fa', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <View style={{ backgroundColor: '#fff', borderRadius: 18, padding: 30, width: '100%', maxWidth: 460, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 16 }} data-testid="verify-portal-box">
        <TouchableOpacity onPress={openUniversity} style={{ alignItems: 'center' }} data-testid="portal-logo-link">
          <Image source={require('../assets/images/icon.png')} style={{ width: 84, height: 84, borderRadius: 42 }} resizeMode="contain" />
          <Text style={{ fontSize: 20, fontWeight: '800', color: '#1a2540', marginTop: 12 }}>جامعة الأحقاف</Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 13, color: '#5b6678', marginTop: 4 }}>بوابة التحقق من الوثائق الرسمية</Text>

        {scanning ? (
          <View style={{ width: '100%', marginTop: 20, alignItems: 'center' }}>
            {Platform.OS === 'web' && (
              // @ts-ignore عنصر فيديو ويب
              <video ref={videoRef} style={{ width: '100%', maxWidth: 380, borderRadius: 12, background: '#000' }} muted />
            )}
            <Text style={{ fontSize: 12, color: '#5b6678', marginTop: 8 }}>وجّه الكاميرا نحو رمز QR على الوثيقة</Text>
            <TouchableOpacity
              onPress={stopScan}
              style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: '#ffcdd2', borderRadius: 10, paddingVertical: 9, paddingHorizontal: 18, marginTop: 10 }}
              data-testid="portal-stop-scan-btn"
            >
              <Ionicons name="close" size={16} color="#c62828" />
              <Text style={{ color: '#c62828', fontWeight: '700', fontSize: 13 }}>إيقاف المسح</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <TouchableOpacity
              onPress={startScan}
              style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#1a2540', borderRadius: 12, padding: 14, marginTop: 22, width: '100%' }}
              data-testid="portal-scan-btn"
            >
              <Ionicons name="camera" size={19} color="#fff" />
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14.5 }}>امسح رمز QR بالكاميرا</Text>
            </TouchableOpacity>
            {!!camErr && <Text style={{ fontSize: 11.5, color: '#c62828', textAlign: 'center', marginTop: 8 }} data-testid="portal-cam-err">{camErr}</Text>}

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, width: '100%', marginVertical: 16 }}>
              <View style={{ flex: 1, height: 1, backgroundColor: '#e6eaf2' }} />
              <Text style={{ fontSize: 11.5, color: '#9aa4b2' }}>أو</Text>
              <View style={{ flex: 1, height: 1, backgroundColor: '#e6eaf2' }} />
            </View>

            <View style={{ width: '100%' }}>
              <Text style={{ fontSize: 12.5, fontWeight: '700', color: '#1a2540', textAlign: 'right', marginBottom: 6 }}>
                أدخل رمز التحقق يدوياً
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
          </>
        )}

        <Text style={{ fontSize: 10.5, color: '#9aa4b2', marginTop: 20, textAlign: 'center' }}>
          هذه البوابة مخصصة للتحقق من صحة الوثائق الصادرة عن جامعة الأحقاف فقط
        </Text>
        <TouchableOpacity onPress={openUniversity} style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 5, marginTop: 10 }} data-testid="portal-site-link">
          <Ionicons name="globe-outline" size={14} color="#00796b" />
          <Text style={{ fontSize: 12, fontWeight: '700', color: '#00796b' }}>الموقع الرسمي للجامعة: ahgaff.edu</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
