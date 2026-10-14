import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Modal,
  ActivityIndicator,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { settingsAPI } from '../services/api';
import { WEEKDAYS_AR } from '../utils/dateUtils';
import { formatTimeArabic, suggestEndTime } from '../utils/timeFormat';
import { TimeRangeSummary } from './TimeRangeSummary';
import RoomPicker from './RoomPicker';
import { courseGroupsAPI } from '../services/api';
import { groupColor } from './CourseGroupsModal';

interface Course {
  id: string;
  name: string;
}

interface AddLectureModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (data: LectureFormData, force?: boolean) => Promise<void>;
  courses?: Course[];
  selectedCourseId?: string;
  showCourseSelector?: boolean;
  title?: string;
  /** حصر القاعات على كلية المقرر */
  facultyId?: string;
}

export interface LectureFormData {
  course_id?: string;
  date: string;
  start_time: string;
  end_time: string;
  room: string;
  notes?: string;
  group?: string;
}

// أوقات المحاضرات: من 01:00 إلى 00:00 (منتصف الليل) بفواصل ربع ساعة
const TIME_SLOTS: string[] = [];
for (let h = 1; h <= 23; h++) {
  const hh = h.toString().padStart(2, '0');
  TIME_SLOTS.push(`${hh}:00`, `${hh}:15`, `${hh}:30`, `${hh}:45`);
}
TIME_SLOTS.push('00:00');

export default function AddLectureModal({
  visible,
  onClose,
  onSave,
  courses = [],
  selectedCourseId,
  showCourseSelector = false,
  title = 'إضافة محاضرة',
  facultyId,
}: AddLectureModalProps) {
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{ type: 'error' | 'warning'; message: string; canForce?: boolean } | null>(null);
  const [semesterDates, setSemesterDates] = useState<{ start: string; end: string } | null>(null);
  const [groups, setGroups] = useState<Array<{ key: string; name: string; count: number; teacher_name?: string }>>([]);
  
  const [formData, setFormData] = useState<LectureFormData>({
    course_id: selectedCourseId || '',
    date: '',
    start_time: '08:00',
    end_time: '09:30',
    room: '',
    notes: '',
  });

  // 👥 مجموعات المقرر المختار
  useEffect(() => {
    if (!visible || !formData.course_id) { setGroups([]); return; }
    courseGroupsAPI.get(formData.course_id).then(r => setGroups(r.data?.groups || [])).catch(() => setGroups([]));
  }, [visible, formData.course_id]);

  // تحميل تواريخ الفصل
  useEffect(() => {
    const loadSemesterDates = async () => {
      try {
        const res = await settingsAPI.get();
        if (res.data.semester_start_date && res.data.semester_end_date) {
          setSemesterDates({
            start: res.data.semester_start_date,
            end: res.data.semester_end_date,
          });
        }
      } catch (error) {
        console.error('Error loading semester dates:', error);
      }
    };
    loadSemesterDates();
  }, []);

  // تحديث course_id عند تغيير selectedCourseId
  useEffect(() => {
    if (selectedCourseId) {
      setFormData(prev => ({ ...prev, course_id: selectedCourseId }));
    }
  }, [selectedCourseId]);

  // إعادة تعيين النموذج عند الفتح
  useEffect(() => {
    if (visible) {
      setBanner(null);
      setFormData({
        course_id: selectedCourseId || (courses.length > 0 ? courses[0].id : ''),
        date: '',
        start_time: '08:00',
        end_time: '09:30',
        room: '',
        notes: '',
        group: '',
      });
    }
  }, [visible]);

  const showAlert = (_title: string, message: string) => {
    setBanner({ type: 'error', message });
  };

  const handleSave = async (force: boolean = false) => {
    setBanner(null);
    if (!formData.date) {
      showAlert('تنبيه', 'يرجى اختيار التاريخ');
      return;
    }
    if (!formData.room.trim()) {
      showAlert('تنبيه', 'يرجى اختيار القاعة');
      return;
    }
    if (formData.start_time && formData.end_time && formData.end_time <= formData.start_time) {
      showAlert(
        'خطأ في الوقت',
        `وقت النهاية (${formatTimeArabic(formData.end_time)}) يقع قبل وقت البداية (${formatTimeArabic(formData.start_time)}).\n\n` +
        `السبب الشائع: اختيار «ص» بدل «م» — أوقات ما بعد الظهر (من 12 ظهراً فما بعد) اختر لها «م».\n` +
        `مثال: 12:30 ظهراً = «12:30 م» وليس «12:30 ص» (منتصف الليل).`
      );
      return;
    }

    // التحقق من أن التاريخ ليس في الماضي
    try {
      const picked = new Date(formData.date + 'T00:00:00');
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (picked.getTime() < today.getTime()) {
        showAlert(
          'تاريخ غير صالح',
          'لا يمكن إنشاء محاضرة بتاريخ ماضٍ.\nاختر تاريخ اليوم أو تاريخاً مستقبلياً.'
        );
        return;
      }
    } catch (_) {
      // ignore date parsing errors and let the backend handle them
    }

    setSaving(true);
    try {
      await onSave(formData, force);
      onClose();
    } catch (error: any) {
      console.error('Error saving lecture:', error);
      const status = error?.response?.status;
      const rawDetail = error?.response?.data?.detail;
      const detail = typeof rawDetail === 'string' ? rawDetail : (rawDetail ? JSON.stringify(rawDetail) : 'حدث خطأ أثناء حفظ المحاضرة');
      if (status === 409 && !force) {
        setBanner({ type: 'warning', message: detail, canForce: true });
      } else {
        setBanner({ type: 'error', message: detail });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.headerBtn}>
            <Ionicons name="close" size={28} color="#333" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{title}</Text>
          <TouchableOpacity 
            onPress={() => handleSave()} 
            disabled={saving || !formData.date || !formData.room}
            style={styles.headerBtn}
            testID="add-lecture-save-btn"
          >
            {saving ? (
              <ActivityIndicator size="small" color="#4caf50" />
            ) : (
              <Text style={[
                styles.saveText, 
                (!formData.date || !formData.room) && styles.saveTextDisabled
              ]}>حفظ</Text>
            )}
          </TouchableOpacity>
        </View>

        {banner && (
          <View style={[styles.banner, banner.type === 'warning' ? styles.bannerWarning : styles.bannerError]} testID="add-lecture-banner">
            <View style={styles.bannerRow}>
              <Ionicons name={banner.type === 'warning' ? 'warning' : 'alert-circle'} size={22} color="#fff" />
              <Text style={styles.bannerText}>{banner.message}</Text>
              <TouchableOpacity onPress={() => setBanner(null)} hitSlop={8} testID="add-lecture-banner-close">
                <Ionicons name="close" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
            {banner.canForce && (
              <View style={styles.bannerActions}>
                <TouchableOpacity style={styles.bannerBtnPrimary} onPress={() => handleSave(true)} disabled={saving} testID="add-lecture-force-btn">
                  <Text style={styles.bannerBtnPrimaryText}>متابعة رغم التعارض</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.bannerBtnGhost} onPress={() => setBanner(null)} testID="add-lecture-cancel-force-btn">
                  <Text style={styles.bannerBtnGhostText}>إلغاء</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {/* Course Selector */}
          {showCourseSelector && courses.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                <Ionicons name="book" size={18} color="#ff9800" /> المقرر
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {courses.map(course => (
                  <TouchableOpacity
                    key={course.id}
                    style={[
                      styles.chip,
                      formData.course_id === course.id && styles.chipActive
                    ]}
                    onPress={() => setFormData({ ...formData, course_id: course.id })}
                  >
                    <Text style={[
                      styles.chipText,
                      formData.course_id === course.id && styles.chipTextActive
                    ]}>{course.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Date - التاريخ فقط بالروزنامة */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              <Ionicons name="calendar" size={18} color="#1565c0" /> التاريخ *
            </Text>
            {Platform.OS === 'web' ? (
              <input
                type="date"
                value={formData.date}
                onChange={(e: any) => {
                  setFormData({ ...formData, date: e.target.value });
                }}
                data-testid="lecture-date-picker"
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '8px',
                  border: '1px solid #e0e0e0',
                  fontSize: '15px',
                  backgroundColor: '#f9f9f9',
                  color: '#333',
                  boxSizing: 'border-box',
                }}
              />
            ) : (
              <TextInput
                style={styles.input}
                value={formData.date}
                onChangeText={(text) => {
                  setFormData({ ...formData, date: text });
                }}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#999"
              />
            )}
            {/* عرض اسم اليوم عند اختيار التاريخ */}
            {formData.date && (() => {
              const [y, m, d] = formData.date.split('-').map(Number);
              if (y && m && d) {
                const dt = new Date(y, m - 1, d);
                const dayName = WEEKDAYS_AR[dt.getDay()];
                return (
                  <Text style={{ fontSize: 14, color: '#1565c0', fontWeight: '600', marginTop: 8, textAlign: 'center' }}>
                    {dayName} - {d} {['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'][m-1]} {y}
                  </Text>
                );
              }
              return null;
            })()}
            {semesterDates && (
              <Text style={styles.hint}>
                فترة الفصل: {semesterDates.start} إلى {semesterDates.end}
              </Text>
            )}
          </View>

          {/* Time */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              <Ionicons name="time" size={18} color="#4caf50" /> الوقت
            </Text>
            
            {Platform.OS === 'web' ? (
              <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.subLabel}>من</Text>
                  <input
                    type="time"
                    value={formData.start_time}
                    onChange={(e: any) => {
                      const v = e.target.value;
                      setFormData({ ...formData, start_time: v, end_time: v ? suggestEndTime(v, formData.start_time, formData.end_time) : formData.end_time });
                    }}
                    data-testid="add-lecture-start-time"
                    style={{
                      width: '100%',
                      padding: '12px',
                      borderRadius: '8px',
                      border: '1px solid #e0e0e0',
                      fontSize: '16px',
                      backgroundColor: '#f9f9f9',
                      color: '#333',
                      textAlign: 'center',
                      boxSizing: 'border-box' as any,
                    }}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.subLabel}>إلى</Text>
                  <input
                    type="time"
                    value={formData.end_time}
                    onChange={(e: any) => setFormData({ ...formData, end_time: e.target.value })}
                    data-testid="add-lecture-end-time"
                    style={{
                      width: '100%',
                      padding: '12px',
                      borderRadius: '8px',
                      border: '1px solid #e0e0e0',
                      fontSize: '16px',
                      backgroundColor: '#f9f9f9',
                      color: '#333',
                      textAlign: 'center',
                      boxSizing: 'border-box' as any,
                    }}
                  />
                </View>
              </View>
            ) : (
              <>
                <Text style={styles.subLabel}>من</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.timesRow}>
                  {TIME_SLOTS.map(time => (
                    <TouchableOpacity
                      key={`start-${time}`}
                      style={[
                        styles.timeBtn,
                        formData.start_time === time && styles.timeBtnActive
                      ]}
                      onPress={() => setFormData({ ...formData, start_time: time, end_time: suggestEndTime(time, formData.start_time, formData.end_time) })}
                    >
                      <Text style={[
                        styles.timeBtnText,
                        formData.start_time === time && styles.timeBtnTextActive
                      ]}>{time}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <Text style={styles.subLabel}>إلى</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.timesRow}>
                  {TIME_SLOTS.map(time => (
                    <TouchableOpacity
                      key={`end-${time}`}
                      style={[
                        styles.timeBtn,
                        formData.end_time === time && styles.timeBtnActive
                      ]}
                      onPress={() => setFormData({ ...formData, end_time: time })}
                    >
                      <Text style={[
                        styles.timeBtnText,
                        formData.end_time === time && styles.timeBtnTextActive
                      ]}>{time}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            )}
            <TimeRangeSummary start={formData.start_time} end={formData.end_time} />
          </View>

          {/* 👥 المجموعة الدراسية */}
          {groups.length > 0 && (
            <View style={styles.section} testID="lecture-group-section">
              <Text style={styles.sectionTitle}>
                <Ionicons name="people" size={18} color="#00838f" /> المجموعة
              </Text>
              <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 }}>
                <TouchableOpacity
                  onPress={() => setFormData({ ...formData, group: '' })}
                  style={[styles.groupChip, !formData.group && { backgroundColor: '#1a2540', borderColor: '#1a2540' }]}
                  testID="lecture-group-all"
                >
                  <Text style={[styles.groupChipText, !formData.group && { color: '#fff' }]}>كل الطلاب</Text>
                </TouchableOpacity>
                {groups.map(g => {
                  const on = formData.group === g.key;
                  const c = groupColor(g.key, groups);
                  return (
                    <TouchableOpacity
                      key={g.key}
                      onPress={() => setFormData({ ...formData, group: g.key })}
                      style={[styles.groupChip, { borderColor: c }, on && { backgroundColor: c }]}
                      testID={`lecture-group-${g.key}`}
                    >
                      <Text style={[styles.groupChipText, { color: on ? '#fff' : c }]}>{g.name} · {g.count}</Text>
                      {g.teacher_name ? <Text style={{ fontSize: 10, color: on ? '#fff' : '#5b6678' }}>{g.teacher_name}</Text> : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={{ fontSize: 11, color: '#78909c', textAlign: 'right', marginTop: 6 }}>
                محاضرة المجموعة تظهر لطلابها فقط ويُحضَّر لهم وحدهم، ويمكن أن تتزامن مع مجموعة أخرى بقاعة مختلفة.
              </Text>
            </View>
          )}

          {/* Room - قائمة منسدلة من القاعات المسجلة */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              <Ionicons name="location" size={18} color="#f44336" /> القاعة *
            </Text>
            <RoomPicker
              value={formData.room}
              onChange={(room) => setFormData({ ...formData, room })}
              testID="lecture-room-picker"
              facultyId={facultyId}
              occurrences={
                formData.date && formData.start_time && formData.end_time
                  ? [{ date: formData.date, start_time: formData.start_time, end_time: formData.end_time }]
                  : undefined
              }
            />
          </View>

          {/* Notes */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              <Ionicons name="document-text" size={18} color="#607d8b" /> ملاحظات
            </Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={formData.notes}
              onChangeText={(text) => setFormData({ ...formData, notes: text })}
              placeholder="ملاحظات إضافية (اختياري)"
              placeholderTextColor="#999"
              multiline
              numberOfLines={3}
            />
          </View>

          {/* Preview */}
          {formData.date && formData.room && (
            <View style={styles.previewSection}>
              <Text style={styles.previewTitle}>معاينة المحاضرة</Text>
              <View style={styles.previewCard}>
                <View style={styles.previewRow}>
                  <Ionicons name="calendar" size={16} color="#1565c0" />
                  <Text style={styles.previewText}>{formData.date}</Text>
                </View>
                <View style={styles.previewRow}>
                  <Ionicons name="time" size={16} color="#4caf50" />
                  <Text style={styles.previewText}>
                    من {formatTimeArabic(formData.start_time)} إلى {formatTimeArabic(formData.end_time)}
                  </Text>
                </View>
                <View style={styles.previewRow}>
                  <Ionicons name="location" size={16} color="#f44336" />
                  <Text style={styles.previewText}>القاعة: {formData.room}</Text>
                </View>
              </View>
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 12,
    padding: 14,
  },
  bannerError: { backgroundColor: '#d32f2f' },
  bannerWarning: { backgroundColor: '#ef6c00' },
  bannerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bannerText: { flex: 1, color: '#fff', fontSize: 14, fontWeight: '700', textAlign: 'right', lineHeight: 21 },
  bannerActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 12 },
  bannerBtnPrimary: { backgroundColor: '#fff', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8 },
  bannerBtnPrimaryText: { color: '#ef6c00', fontWeight: '800', fontSize: 14 },
  bannerBtnGhost: { borderWidth: 1.5, borderColor: '#fff', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8 },
  bannerBtnGhostText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  groupChip: { borderWidth: 1.5, borderColor: '#dfe5ee', borderRadius: 10, paddingVertical: 7, paddingHorizontal: 12, alignItems: 'center', backgroundColor: '#fff' },
  groupChipText: { fontSize: 13, fontWeight: '700', color: '#334155' },
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerBtn: {
    width: 60,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  saveText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#4caf50',
    textAlign: 'right',
  },
  saveTextDisabled: {
    color: '#ccc',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  subLabel: {
    fontSize: 13,
    color: '#666',
    marginBottom: 8,
    marginTop: 8,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#f5f5f5',
    borderRadius: 20,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  chipActive: {
    backgroundColor: '#ff9800',
    borderColor: '#ff9800',
  },
  chipText: {
    fontSize: 14,
    color: '#666',
  },
  chipTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    textAlign: 'right',
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  hint: {
    fontSize: 12,
    color: '#666',
    marginTop: 8,
    textAlign: 'center',
  },
  timesRow: {
    marginBottom: 8,
  },
  timeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  timeBtnActive: {
    backgroundColor: '#4caf50',
    borderColor: '#4caf50',
  },
  timeBtnText: {
    fontSize: 14,
    color: '#666',
  },
  timeBtnTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  previewSection: {
    backgroundColor: '#e8f5e9',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  previewTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2e7d32',
    marginBottom: 12,
  },
  previewCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  previewText: {
    fontSize: 14,
    color: '#333',
  },
});
