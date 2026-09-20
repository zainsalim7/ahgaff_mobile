import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, Image, ScrollView, Platform, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// 🔍 عارض صورة بتكبير: عجلة الماوس/أزرار + سحب للتحريك (ويب) — قرص وتمرير (جوال)
export const ZoomableImageModal = ({ uri, visible, onClose, title }: { uri: string; visible: boolean; onClose: () => void; title?: string }) => {
  const { width, height } = useWindowDimensions();
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const clamp = (v: number) => Math.min(6, Math.max(1, v));
  const reset = () => { setScale(1); setPos({ x: 0, y: 0 }); };
  const zoom = (delta: number) => setScale((s) => { const n = clamp(+(s + delta).toFixed(2)); if (n === 1) setPos({ x: 0, y: 0 }); return n; });

  const webHandlers = Platform.OS === 'web' ? {
    onWheel: (e: any) => { e.preventDefault?.(); zoom(e.deltaY < 0 ? 0.25 : -0.25); },
    onMouseDown: (e: any) => { drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }; },
    onMouseMove: (e: any) => { if (!drag.current || scale === 1) return; setPos({ x: drag.current.px + (e.clientX - drag.current.x), y: drag.current.py + (e.clientY - drag.current.y) }); },
    onMouseUp: () => { drag.current = null; },
    onMouseLeave: () => { drag.current = null; },
    onDoubleClick: () => (scale === 1 ? setScale(2.5) : reset()),
  } : {};

  const imgW = width * 0.96, imgH = height * 0.8;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)' }} testID="zoom-image-modal">
        <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', padding: 12, paddingTop: Platform.OS === 'web' ? 12 : 40 }}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13, flex: 1, textAlign: 'right' }} numberOfLines={1}>{title || 'معاينة السند'}</Text>
          <View style={{ flexDirection: 'row-reverse', gap: 6, alignItems: 'center' }}>
            <TouchableOpacity onPress={() => zoom(0.5)} style={btn} testID="zoom-in-btn"><Ionicons name="add" size={20} color="#fff" /></TouchableOpacity>
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12, minWidth: 44, textAlign: 'center' }} testID="zoom-level">{Math.round(scale * 100)}%</Text>
            <TouchableOpacity onPress={() => zoom(-0.5)} style={btn} testID="zoom-out-btn"><Ionicons name="remove" size={20} color="#fff" /></TouchableOpacity>
            <TouchableOpacity onPress={reset} style={btn} testID="zoom-reset-btn"><Ionicons name="contract-outline" size={18} color="#fff" /></TouchableOpacity>
            <TouchableOpacity onPress={onClose} style={[btn, { backgroundColor: '#c62828' }]} testID="zoom-close-btn"><Ionicons name="close" size={20} color="#fff" /></TouchableOpacity>
          </View>
        </View>
        {Platform.OS === 'web' ? (
          <View style={{ flex: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', cursor: scale > 1 ? 'grab' : 'zoom-in' } as any} {...(webHandlers as any)} testID="zoom-stage">
            <Image source={{ uri }} resizeMode="contain"
              style={{ width: imgW, height: imgH, transform: [{ translateX: pos.x }, { translateY: pos.y }, { scale }] } as any} />
          </View>
        ) : (
          <ScrollView maximumZoomScale={6} minimumZoomScale={1} bouncesZoom centerContent contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Image source={{ uri }} resizeMode="contain" style={{ width: imgW, height: imgH }} />
          </ScrollView>
        )}
        <Text style={{ color: '#9e9e9e', fontSize: 11, textAlign: 'center', paddingBottom: 14 }}>
          {Platform.OS === 'web' ? 'عجلة الماوس للتكبير · اسحب للتحريك · نقرة مزدوجة للتبديل' : 'قرّب بإصبعين للتكبير'}
        </Text>
      </View>
    </Modal>
  );
};

const btn = { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center' as const, justifyContent: 'center' as const };
