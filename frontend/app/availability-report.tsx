/**
 * تقارير الفراغ/الإشغال للقاعات والأساتذة
 * يستخدم endpoints:
 *  - /api/weekly-schedule/availability/rooms
 *  - /api/weekly-schedule/availability/teachers
 */
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Platform, SafeAreaView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import api, { facultiesAPI, scheduleAPI } from '../src/services/api';

const DAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'];

export default function AvailabilityReport() {
  // فلاتر
  const [reportType, setReportType] = useState<'rooms' | 'teachers'>('rooms');
  const [day, setDay] = useState<string>('');
  const [slot, setSlot] = useState<number | ''>('');
  const [facultyId, setFacultyId] = useState<string>('');
  const [departmentId, setDepartmentId] = useState<string>('');

  // البيانات
  const [faculties, setFaculties] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [timeSlots, setTimeSlots] = useState<any[]>([]);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [executed, setExecuted] = useState(false);

  // تحميل الفلاتر الأولية
  useEffect(() => {
    (async () => {
      try {
        const [facRes, deptRes, setRes] = await Promise.all([
          facultiesAPI.getAll(),
          api.get('/departments'),
          api.get('/schedule-settings'),
        ]);
        // 🛡️ تطبيع دفاعي: نضمن مصفوفات دائماً حتى لو تغيّر شكل الاستجابة (يمنع الصفحة البيضاء)
        const facData = facRes.data;
        const deptData = deptRes.data;
        setFaculties(Array.isArray(facData) ? facData : (facData?.faculties || []));
        setDepartments(Array.isArray(deptData) ? deptData : (deptData?.departments || []));
        const slots = setRes.data?.time_slots;
        setTimeSlots((Array.isArray(slots) ? slots : []).sort((a: any, b: any) => a.slot_number - b.slot_number));
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  // إعادة تعيين النتيجة عند تغيير أي فلتر
  useEffect(() => {
    setExecuted(false);
    setData(null);
  }, [reportType, day, slot, facultyId, departmentId]);

  const handleExecute = useCallback(async () => {
    if (!day || slot === '') {
      Platform.OS === 'web' && window.alert('اختر اليوم والفترة أولاً');
      return;
    }
    setLoading(true);
    try {
      const params: any = { day_of_week: day, slot_number: slot };
      if (facultyId) params.faculty_id = facultyId;
      if (departmentId) params.department_id = departmentId;
      const path = reportType === 'rooms'
        ? '/weekly-schedule/availability/rooms'
        : '/weekly-schedule/availability/teachers';
      const res = await api.get(path, { params });
      const d = res.data;
      // 🛡️ نتحقق أن الاستجابة بالشكل المتوقع قبل العرض (يمنع انهيار الصفحة)
      if (!d || typeof d !== 'object' || (!Array.isArray(d.rooms) && !Array.isArray(d.teachers))) {
        Platform.OS === 'web' && window.alert('استجابة غير متوقعة من الخادم — تأكد من تحديث نسخة الخادم (النشر)');
        return;
      }
      setData(d);
      setExecuted(true);
    } catch (e: any) {
      const err = e?.response?.data?.detail || 'فشل التحميل';
      Platform.OS === 'web' && window.alert(err);
    } finally {
      setLoading(false);
    }
  }, [day, slot, facultyId, departmentId, reportType]);

  const slotTimeStr = (n: number) => {
    const ts = timeSlots.find(t => t.slot_number === n);
    return ts ? `${ts.start_time}-${ts.end_time}` : '';
  };

  // ألوان حالة التفضيل
  const prefColors: any = {
    preferred: { bg: '#e8f5e9', text: '#1b5e20', label: '🟢 ضمن تفضيلاته' },
    neutral: { bg: '#f5f5f5', text: '#555', label: '⚪ بدون تفضيل' },
    non_preferred_day: { bg: '#fff8e1', text: '#e65100', label: '🟡 يوم غير مفضّل' },
    unavailable: { bg: '#ffebee', text: '#c62828', label: '🔴 غير متاح' },
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f5f7fa' }}>
      {/* Header */}
      <View style={{
        flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
        padding: 12, backgroundColor: '#fff',
        borderBottomWidth: 1, borderBottomColor: '#e0e0e0',
      }}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-forward" size={22} color="#333" />
        </TouchableOpacity>
        <Text style={{ fontSize: 16, fontWeight: '800', color: '#222', flex: 1 }}>
          تقارير الفراغ/الإشغال
        </Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12 }}>
        {/* اختيار نوع التقرير */}
        <View style={{ flexDirection: 'row-reverse', gap: 8, marginBottom: 10 }}>
          {[
            { v: 'rooms', l: '🏛 القاعات', c: '#1565c0' },
            { v: 'teachers', l: '👨‍🏫 الأساتذة', c: '#6a1b9a' },
          ].map(o => (
            <TouchableOpacity
              key={o.v}
              data-testid={`report-type-${o.v}`}
              onPress={() => setReportType(o.v as any)}
              style={{
                flex: 1,
                paddingVertical: 12,
                borderRadius: 10,
                backgroundColor: reportType === o.v ? o.c : '#fff',
                borderWidth: 1.5,
                borderColor: reportType === o.v ? o.c : '#ddd',
                alignItems: 'center',
              }}
            >
              <Text style={{
                fontSize: 14, fontWeight: '800',
                color: reportType === o.v ? '#fff' : '#444',
              }}>{o.l}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* فلاتر */}
        <View style={{ backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 10 }}>
          {/* اليوم */}
          <Text style={{ fontSize: 12, fontWeight: '700', color: '#444', textAlign: 'right', marginBottom: 6 }}>اليوم *</Text>
          <View style={{ flexDirection: 'row-reverse', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
            {DAYS.map(d => (
              <TouchableOpacity
                key={d}
                data-testid={`day-${d}`}
                onPress={() => setDay(d)}
                style={{
                  paddingHorizontal: 10, paddingVertical: 6,
                  borderRadius: 6,
                  backgroundColor: day === d ? '#1565c0' : '#f5f5f5',
                  borderWidth: 1,
                  borderColor: day === d ? '#1565c0' : '#ddd',
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: '700', color: day === d ? '#fff' : '#444' }}>{d}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* الفترة */}
          <Text style={{ fontSize: 12, fontWeight: '700', color: '#444', textAlign: 'right', marginBottom: 6 }}>الفترة *</Text>
          <View style={{ flexDirection: 'row-reverse', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
            {timeSlots.map(ts => (
              <TouchableOpacity
                key={ts.slot_number}
                data-testid={`slot-${ts.slot_number}`}
                onPress={() => setSlot(ts.slot_number)}
                style={{
                  paddingHorizontal: 10, paddingVertical: 6,
                  borderRadius: 6,
                  backgroundColor: slot === ts.slot_number ? '#1565c0' : '#f5f5f5',
                  borderWidth: 1,
                  borderColor: slot === ts.slot_number ? '#1565c0' : '#ddd',
                  alignItems: 'center',
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: '700', color: slot === ts.slot_number ? '#fff' : '#444' }}>
                  ف{ts.slot_number}
                </Text>
                <Text style={{ fontSize: 9, color: slot === ts.slot_number ? '#fff' : '#888' }}>
                  {ts.start_time}-{ts.end_time}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* الكلية */}
          {Platform.OS === 'web' && (
            <>
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#444', textAlign: 'right', marginBottom: 6 }}>الكلية (اختياري)</Text>
              <select
                value={facultyId}
                onChange={(e: any) => setFacultyId(e.target.value)}
                style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ddd', fontSize: 13, marginBottom: 10, direction: 'rtl' as any }}
              >
                <option value="">-- كل الكليات --</option>
                {faculties.map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>

              {reportType === 'teachers' && (
                <>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#444', textAlign: 'right', marginBottom: 6 }}>القسم (اختياري)</Text>
                  <select
                    value={departmentId}
                    onChange={(e: any) => setDepartmentId(e.target.value)}
                    style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ddd', fontSize: 13, marginBottom: 10, direction: 'rtl' as any }}
                  >
                    <option value="">-- كل الأقسام --</option>
                    {departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </>
              )}
            </>
          )}

          {/* زر تنفيذ */}
          <TouchableOpacity
            data-testid="execute-report-btn"
            onPress={handleExecute}
            disabled={loading || !day || slot === ''}
            style={{
              flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 6,
              backgroundColor: (!day || slot === '') ? '#bdbdbd' : '#1565c0',
              paddingVertical: 12, borderRadius: 10,
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="search" size={16} color="#fff" />
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>تنفيذ التقرير</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* النتائج */}
        {!executed && !loading ? (
          <View style={{ backgroundColor: '#fff', padding: 24, borderRadius: 10, alignItems: 'center' }}>
            <Ionicons name="information-circle-outline" size={36} color="#bdbdbd" />
            <Text style={{ fontSize: 13, color: '#888', textAlign: 'center', marginTop: 8 }}>
              اختر اليوم والفترة ثم اضغط "تنفيذ التقرير"
            </Text>
          </View>
        ) : null}

        {executed && data ? (
          <>
            {/* ملخص الإحصائيات */}
            <View style={{ backgroundColor: '#fff', padding: 12, borderRadius: 10, marginBottom: 10 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', textAlign: 'right', marginBottom: 8 }}>
                📊 ملخص — {day} | الفترة {slot} ({slotTimeStr(slot as number)})
              </Text>
              <View style={{ flexDirection: 'row-reverse', gap: 6 }}>
                <View style={{ flex: 1, backgroundColor: '#e8f5e9', padding: 10, borderRadius: 8, alignItems: 'center' }}>
                  <Text style={{ fontSize: 24, fontWeight: '900', color: '#1b5e20' }}>
                    {reportType === 'rooms' ? data.free_count : data.free_total}
                  </Text>
                  <Text style={{ fontSize: 11, color: '#1b5e20', fontWeight: '700' }}>
                    {reportType === 'rooms' ? 'قاعة فارغة' : 'أستاذ متاح'}
                  </Text>
                </View>
                <View style={{ flex: 1, backgroundColor: '#ffebee', padding: 10, borderRadius: 8, alignItems: 'center' }}>
                  <Text style={{ fontSize: 24, fontWeight: '900', color: '#c62828' }}>{data.busy_count}</Text>
                  <Text style={{ fontSize: 11, color: '#c62828', fontWeight: '700' }}>
                    {reportType === 'rooms' ? 'قاعة مشغولة' : 'أستاذ مشغول'}
                  </Text>
                </View>
                <View style={{ flex: 1, backgroundColor: '#e3f2fd', padding: 10, borderRadius: 8, alignItems: 'center' }}>
                  <Text style={{ fontSize: 24, fontWeight: '900', color: '#0d47a1' }}>{data.total}</Text>
                  <Text style={{ fontSize: 11, color: '#0d47a1', fontWeight: '700' }}>الإجمالي</Text>
                </View>
              </View>
              {reportType === 'teachers' ? (
                <View style={{ flexDirection: 'row-reverse', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                  <View style={{ backgroundColor: '#e8f5e9', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 }}>
                    <Text style={{ fontSize: 10, color: '#1b5e20', fontWeight: '700' }}>🟢 مفضّل: {data.free_preferred}</Text>
                  </View>
                  <View style={{ backgroundColor: '#f5f5f5', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 }}>
                    <Text style={{ fontSize: 10, color: '#555', fontWeight: '700' }}>⚪ محايد: {data.free_neutral}</Text>
                  </View>
                  <View style={{ backgroundColor: '#ffebee', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 }}>
                    <Text style={{ fontSize: 10, color: '#c62828', fontWeight: '700' }}>🔴 غير متاح: {data.free_unavailable}</Text>
                  </View>
                </View>
              ) : null}
            </View>

            {/* قائمة القاعات/الأساتذة */}
            <View style={{ backgroundColor: '#fff', borderRadius: 10, overflow: 'hidden' }}>
              {reportType === 'rooms' ? (
                (Array.isArray(data.rooms) ? data.rooms : []).map((r: any, idx: number) => (
                  <View
                    key={r.id}
                    style={{
                      flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
                      padding: 10,
                      borderBottomWidth: idx < data.rooms.length - 1 ? 1 : 0,
                      borderBottomColor: '#f0f0f0',
                      backgroundColor: r.status === 'free' ? '#f1f8e9' : '#fff',
                    }}
                  >
                    <Ionicons
                      name={r.status === 'free' ? 'checkmark-circle' : 'close-circle'}
                      size={20}
                      color={r.status === 'free' ? '#2e7d32' : '#c62828'}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontWeight: '800', color: '#222', textAlign: 'right' }}>
                        {r.name}
                      </Text>
                      <Text style={{ fontSize: 11, color: '#666', textAlign: 'right' }}>
                        {r.type === 'lab' ? '🧪 مختبر' : '🏛 قاعة عادية'}
                        {r.capacity ? ` · سعة ${r.capacity}` : ''}
                      </Text>
                      {Array.isArray(r.lectures) && r.lectures.length > 0 ? (
                        r.lectures.map((l: any, li: number) => (
                          <Text key={li} style={{ fontSize: 10, color: '#c62828', textAlign: 'right', marginTop: 2 }}>
                            🔒 {l.course_code} {l.course_name} - {l.teacher_name}
                            {l.sections_label ? ` (${l.sections_label})` : ''}
                            {l.start_time ? ` · ⏱ ${l.start_time}-${l.end_time}` : ''}
                            {l.is_shared ? ' · 🔗 مشتركة' : ''}
                          </Text>
                        ))
                      ) : r.details ? (
                        <Text style={{ fontSize: 10, color: '#c62828', textAlign: 'right', marginTop: 2 }}>
                          🔒 مشغولة: {r.details.course_code} {r.details.course_name} - {r.details.teacher_name}
                          {r.details.section ? ` (شعبة ${r.details.section})` : ''}
                        </Text>
                      ) : null}
                    </View>
                    <View style={{
                      paddingHorizontal: 10, paddingVertical: 4, borderRadius: 14,
                      backgroundColor: r.status === 'free' ? '#2e7d32' : '#c62828',
                    }}>
                      <Text style={{ fontSize: 10, color: '#fff', fontWeight: '800' }}>
                        {r.status === 'free' ? 'فارغة' : 'مشغولة'}
                      </Text>
                    </View>
                  </View>
                ))
              ) : (
                data.teachers.map((t: any, idx: number) => {
                  const pref = prefColors[t.preference_status] || prefColors.neutral;
                  return (
                    <View
                      key={t.id}
                      style={{
                        flexDirection: 'row-reverse', alignItems: 'center', gap: 10,
                        padding: 10,
                        borderBottomWidth: idx < data.teachers.length - 1 ? 1 : 0,
                        borderBottomColor: '#f0f0f0',
                        backgroundColor: t.status === 'free' ? (t.preference_status === 'preferred' ? '#e8f5e9' : '#fafafa') : '#fff',
                      }}
                    >
                      <Ionicons
                        name={t.status === 'free' ? 'person-add' : 'person'}
                        size={20}
                        color={t.status === 'free' ? '#2e7d32' : '#c62828'}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 13, fontWeight: '800', color: '#222', textAlign: 'right' }}>
                          {t.full_name}
                        </Text>
                        <Text style={{ fontSize: 10, color: '#777', textAlign: 'right' }}>
                          {t.employee_id ? `رقم وظيفي: ${t.employee_id}` : ''}
                          {t.has_preferences ? ' · 📋 له تفضيلات' : ' · ⚪ بدون تفضيلات'}
                        </Text>
                        {Array.isArray(t.lectures) && t.lectures.length > 0 ? (
                          t.lectures.map((l: any, li: number) => (
                            <Text key={li} style={{ fontSize: 10, color: '#c62828', textAlign: 'right', marginTop: 2 }}>
                              🔒 {l.course_code} {l.course_name}
                              {l.room_name ? ` - 🏛 ${l.room_name}` : ''}
                              {l.sections_label ? ` (${l.sections_label})` : ''}
                              {l.start_time ? ` · ⏱ ${l.start_time}-${l.end_time}` : ''}
                              {l.is_shared ? ' · 🔗 مشتركة' : ''}
                            </Text>
                          ))
                        ) : t.details ? (
                          <Text style={{ fontSize: 10, color: '#c62828', textAlign: 'right', marginTop: 2 }}>
                            🔒 مشغول: {t.details.course_code} {t.details.course_name}
                            {t.details.room_name ? ` - 🏛 ${t.details.room_name}` : ''}
                          </Text>
                        ) : (
                          <View style={{
                            alignSelf: 'flex-end', marginTop: 4,
                            paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10,
                            backgroundColor: pref.bg,
                          }}>
                            <Text style={{ fontSize: 10, fontWeight: '700', color: pref.text }}>{pref.label}</Text>
                          </View>
                        )}
                      </View>
                      <View style={{
                        paddingHorizontal: 10, paddingVertical: 4, borderRadius: 14,
                        backgroundColor: t.status === 'free' ? '#2e7d32' : '#c62828',
                      }}>
                        <Text style={{ fontSize: 10, color: '#fff', fontWeight: '800' }}>
                          {t.status === 'free' ? 'متاح' : 'مشغول'}
                        </Text>
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

