import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import api from '../src/services/api';

interface SemesterMatch {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  lectures_to_update: number;
}

interface Preview {
  total_lectures: number;
  without_semester: number;
  matched_by_semester: SemesterMatch[];
  matched_by_course?: { semester_id: string; semester_name: string; lectures_to_update: number }[];
  matched_total: number;
  unmatched: number;
  warning?: string;
}

interface OrphanLecture {
  id: string;
  course_id: string | null;
  course_name: string;
  course_code: string;
  date: string | null;
  start_time: string;
  end_time: string;
  room: string;
  status: string;
}

interface SemesterOption {
  id: string;
  name: string;
  status: string;
}

const showAlert = (title: string, msg: string) => {
  if (Platform.OS === 'web') window.alert(`${title}\n\n${msg}`);
  else Alert.alert(title, msg);
};

const askConfirm = async (title: string, msg: string): Promise<boolean> => {
  if (Platform.OS === 'web') return window.confirm(`${title}\n\n${msg}`);
  return new Promise((resolve) => {
    Alert.alert(title, msg, [
      { text: 'إلغاء', style: 'cancel', onPress: () => resolve(false) },
      { text: 'تنفيذ', onPress: () => resolve(true) },
    ]);
  });
};

export default function BackfillSemestersScreen() {
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [resultMsg, setResultMsg] = useState<string>('');
  const [orphans, setOrphans] = useState<OrphanLecture[] | null>(null);
  const [orphanSems, setOrphanSems] = useState<SemesterOption[]>([]);
  const [orphansLoading, setOrphansLoading] = useState(false);
  const [resolving, setResolving] = useState(false);

  const fetchPreview = useCallback(async () => {
    try {
      setLoading(true);
      setResultMsg('');
      setOrphans(null);
      const res = await api.get('/admin/backfill-lecture-semesters/preview');
      setPreview(res.data);
    } catch (e: any) {
      showAlert('خطأ', e?.response?.data?.detail || 'فشل تحميل المعاينة');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchOrphans = useCallback(async () => {
    try {
      setOrphansLoading(true);
      const res = await api.get('/admin/backfill-lecture-semesters/unmatched');
      setOrphans(res.data?.lectures || []);
      setOrphanSems(res.data?.semesters || []);
    } catch (e: any) {
      showAlert('خطأ', e?.response?.data?.detail || 'فشل تحميل المحاضرات اليتيمة');
    } finally {
      setOrphansLoading(false);
    }
  }, []);

  const resolveOrphans = async (action: 'assign' | 'delete', semesterId?: string, semesterName?: string) => {
    if (!orphans || orphans.length === 0) return;
    const msg =
      action === 'delete'
        ? `سيتم حذف ${orphans.length} محاضرة يتيمة نهائياً من قاعدة البيانات.\n\nهل أنت متأكد؟`
        : `سيتم إسناد ${orphans.length} محاضرة إلى فصل "${semesterName}".\n\nهل تريد المتابعة؟`;
    const ok = await askConfirm('تأكيد المعالجة', msg);
    if (!ok) return;
    try {
      setResolving(true);
      const res = await api.post('/admin/backfill-lecture-semesters/resolve', {
        lecture_ids: orphans.map((l) => l.id),
        action,
        semester_id: semesterId,
      });
      setResultMsg(res.data?.message || 'تمت المعالجة');
      setOrphans(null);
      await fetchPreview();
    } catch (e: any) {
      showAlert('خطأ', e?.response?.data?.detail || 'فشلت المعالجة');
    } finally {
      setResolving(false);
    }
  };

  const handleExecute = async () => {
    if (!preview || preview.matched_total === 0) {
      showAlert('لا يوجد ما يُحدَّث', 'كل المحاضرات إما لها فصل بالفعل أو خارج نطاق الفصول.');
      return;
    }
    const ok = await askConfirm(
      'تأكيد التنفيذ',
      `سيتم إسناد semester_id لـ ${preview.matched_total} محاضرة بناءً على نطاق التاريخ. هذا الإجراء يُحدّث قاعدة البيانات.\n\nهل تريد المتابعة؟`
    );
    if (!ok) return;
    try {
      setExecuting(true);
      const res = await api.post('/admin/backfill-lecture-semesters/execute');
      setResultMsg(res.data?.message || 'تم التنفيذ');
      await fetchPreview();
    } catch (e: any) {
      showAlert('خطأ', e?.response?.data?.detail || 'فشل التنفيذ');
    } finally {
      setExecuting(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'إصلاح فصول المحاضرات', headerBackTitle: 'رجوع' }} />
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <ScrollView contentContainerStyle={{ padding: 12 }}>
          <View style={styles.headerCard}>
            <Ionicons name="construct" size={32} color="#fff" />
            <Text style={styles.headerTitle}>إصلاح فصول المحاضرات</Text>
            <Text style={styles.headerSub}>
              أداة تربط المحاضرات القديمة بالفصول الدراسية بناءً على تاريخ كل محاضرة
            </Text>
          </View>

          <View style={styles.infoBox}>
            <Ionicons name="information-circle" size={18} color="#1565c0" />
            <Text style={styles.infoText}>
              تستخدم هذه الأداة لإصلاح المحاضرات التي تم إنشاؤها قبل تفعيل ربط الفصول التلقائي.
              المحاضرات الجديدة تُربط تلقائياً.
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.btn, styles.previewBtn, loading && { opacity: 0.6 }]}
            onPress={fetchPreview}
            disabled={loading}
            testID="preview-btn"
          >
            {loading ? <ActivityIndicator color="#fff" /> : (
              <>
                <Ionicons name="eye" size={18} color="#fff" />
                <Text style={styles.btnText}>معاينة</Text>
              </>
            )}
          </TouchableOpacity>

          {preview && (
            <>
              <View style={styles.statsCard}>
                <Text style={styles.cardTitle}>الإحصائيات الحالية</Text>
                <View style={styles.statRow}>
                  <Text style={styles.statLabel}>إجمالي المحاضرات</Text>
                  <Text style={styles.statValue}>{preview.total_lectures}</Text>
                </View>
                <View style={styles.statRow}>
                  <Text style={styles.statLabel}>بدون semester_id</Text>
                  <Text style={[styles.statValue, { color: '#ef6c00' }]}>{preview.without_semester}</Text>
                </View>
                <View style={styles.statRow}>
                  <Text style={styles.statLabel}>قابلة للتحديث</Text>
                  <Text style={[styles.statValue, { color: '#2e7d32' }]}>{preview.matched_total}</Text>
                </View>
                <View style={styles.statRow}>
                  <Text style={styles.statLabel}>خارج نطاق أي فصل</Text>
                  <Text style={[styles.statValue, { color: '#c62828' }]}>{preview.unmatched}</Text>
                </View>
              </View>

              {preview.warning && (
                <View style={styles.warnBox}>
                  <Ionicons name="warning" size={18} color="#ef6c00" />
                  <Text style={styles.warnText}>{preview.warning}</Text>
                </View>
              )}

              {preview.matched_by_semester.length > 0 && (
                <View style={styles.semCard}>
                  <Text style={styles.cardTitle}>التوزيع حسب الفصل</Text>
                  {preview.matched_by_semester.map((sem) => (
                    <View key={sem.id} style={styles.semRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.semName}>{sem.name}</Text>
                        <Text style={styles.semDates}>
                          من {sem.start_date} إلى {sem.end_date}
                        </Text>
                      </View>
                      <View style={styles.semCount}>
                        <Text style={styles.semCountText}>{sem.lectures_to_update}</Text>
                        <Text style={styles.semCountLabel}>محاضرة</Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}

              <TouchableOpacity
                style={[
                  styles.btn,
                  styles.executeBtn,
                  (executing || preview.matched_total === 0) && { opacity: 0.5 },
                ]}
                onPress={handleExecute}
                disabled={executing || preview.matched_total === 0}
                testID="execute-btn"
              >
                {executing ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Ionicons name="checkmark-done" size={18} color="#fff" />
                    <Text style={styles.btnText}>تنفيذ التحديث ({preview.matched_total})</Text>
                  </>
                )}
              </TouchableOpacity>

              {preview.unmatched > 0 && (
                <TouchableOpacity
                  style={[styles.btn, styles.orphanBtn, orphansLoading && { opacity: 0.6 }]}
                  onPress={fetchOrphans}
                  disabled={orphansLoading}
                  testID="show-orphans-btn"
                >
                  {orphansLoading ? <ActivityIndicator color="#fff" /> : (
                    <>
                      <Ionicons name="alert-circle" size={18} color="#fff" />
                      <Text style={styles.btnText}>عرض المحاضرات اليتيمة ({preview.unmatched})</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}

              {orphans && orphans.length > 0 && (
                <View style={styles.semCard} testID="orphans-list">
                  <Text style={styles.cardTitle}>
                    محاضرات يتيمة — بلا فصل ومقررها بلا فصل وتاريخها خارج كل النطاقات
                  </Text>
                  {orphans.map((l) => (
                    <View key={l.id} style={styles.semRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.semName}>
                          {l.course_name}{l.course_code ? ` (${l.course_code})` : ''}
                        </Text>
                        <Text style={styles.semDates}>
                          {l.date || 'بدون تاريخ'} • {l.start_time}-{l.end_time}
                          {l.room ? ` • قاعة ${l.room}` : ''} • {l.status}
                        </Text>
                      </View>
                    </View>
                  ))}

                  <Text style={[styles.cardTitle, { marginTop: 14 }]}>معالجة الكل:</Text>
                  {orphanSems.map((s) => (
                    <TouchableOpacity
                      key={s.id}
                      style={[styles.btn, styles.assignBtn, resolving && { opacity: 0.5 }]}
                      onPress={() => resolveOrphans('assign', s.id, s.name)}
                      disabled={resolving}
                      testID={`assign-to-${s.id}`}
                    >
                      <Ionicons name="link" size={16} color="#fff" />
                      <Text style={styles.btnText}>إسناد الكل إلى: {s.name}</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity
                    style={[styles.btn, styles.deleteBtn, resolving && { opacity: 0.5 }]}
                    onPress={() => resolveOrphans('delete')}
                    disabled={resolving}
                    testID="delete-orphans-btn"
                  >
                    <Ionicons name="trash" size={16} color="#fff" />
                    <Text style={styles.btnText}>حذف الكل نهائياً</Text>
                  </TouchableOpacity>
                </View>
              )}

              {orphans && orphans.length === 0 && (
                <View style={styles.successBox}>
                  <Ionicons name="checkmark-circle" size={20} color="#2e7d32" />
                  <Text style={styles.successText}>لا توجد محاضرات يتيمة 🎉</Text>
                </View>
              )}

              {resultMsg ? (
                <View style={styles.successBox}>
                  <Ionicons name="checkmark-circle" size={20} color="#2e7d32" />
                  <Text style={styles.successText}>{resultMsg}</Text>
                </View>
              ) : null}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fb' },
  headerCard: {
    backgroundColor: '#7b1fa2',
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '700', marginTop: 8 },
  headerSub: {
    color: '#e1bee7',
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 18,
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: '#e3f2fd',
    padding: 12,
    borderRadius: 10,
    gap: 8,
    marginBottom: 12,
  },
  infoText: { flex: 1, color: '#1565c0', fontSize: 12, lineHeight: 18, textAlign: 'right' },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 10,
    marginBottom: 12,
  },
  previewBtn: { backgroundColor: '#1565c0' },
  executeBtn: { backgroundColor: '#2e7d32' },
  orphanBtn: { backgroundColor: '#ef6c00' },
  assignBtn: { backgroundColor: '#1565c0', paddingVertical: 10, marginBottom: 8 },
  deleteBtn: { backgroundColor: '#c62828', paddingVertical: 10, marginBottom: 0 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  statsCard: {
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#212121', marginBottom: 10, textAlign: 'right' },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
  },
  statLabel: { fontSize: 13, color: '#666' },
  statValue: { fontSize: 14, fontWeight: '700', color: '#212121' },
  warnBox: {
    flexDirection: 'row',
    backgroundColor: '#fff3e0',
    padding: 12,
    borderRadius: 10,
    gap: 8,
    marginBottom: 12,
    alignItems: 'flex-start',
  },
  warnText: { flex: 1, color: '#ef6c00', fontSize: 12, textAlign: 'right' },
  semCard: {
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  semRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
    gap: 10,
  },
  semName: { fontSize: 13, fontWeight: '700', color: '#1565c0', textAlign: 'right' },
  semDates: { fontSize: 11, color: '#777', marginTop: 2, textAlign: 'right' },
  semCount: {
    backgroundColor: '#e8f5e9',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    alignItems: 'center',
  },
  semCountText: { color: '#2e7d32', fontSize: 16, fontWeight: '800' },
  semCountLabel: { color: '#558b2f', fontSize: 10 },
  successBox: {
    flexDirection: 'row',
    backgroundColor: '#e8f5e9',
    padding: 12,
    borderRadius: 10,
    gap: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#a5d6a7',
  },
  successText: { color: '#2e7d32', fontSize: 13, fontWeight: '700', flex: 1, textAlign: 'right' },
});
