import React from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { Ionicons } from '@expo/vector-icons';

export interface StudentFormValues {
  student_id: string;
  full_name: string;
  department_id: string;
  level: string;
  section: string;
  phone: string;
  email: string;
  nationality: string;
  password: string;
  program_code: string;
  enrollment_year: string;
}

export const emptyStudentForm: StudentFormValues = {
  student_id: '',
  full_name: '',
  department_id: '',
  level: '1',
  section: '',
  phone: '',
  email: '',
  nationality: '',
  password: '',
  program_code: '',
  enrollment_year: '',
};

interface Props {
  values: StudentFormValues;
  onChange: (next: StudentFormValues) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitting?: boolean;
  /**
   * 'standalone' — تُظهر القسم/المستوى/الشعبة كحقول قابلة للتعديل
   * 'course' — تخفي القسم/المستوى/الشعبة (لأنها مأخوذة من المقرر)
   */
  mode: 'standalone' | 'course';
  departments?: Array<{ id: string; name: string }>;
  /** نص ملخّص في رأس النموذج (مثل اسم المقرر) */
  contextLabel?: string;
  submitLabel?: string;
}

export const AddStudentForm: React.FC<Props> = ({
  values, onChange, onSubmit, onCancel, submitting,
  mode, departments = [], contextLabel, submitLabel,
}) => {
  const set = (patch: Partial<StudentFormValues>) => onChange({ ...values, ...patch });

  return (
    <ScrollView contentContainerStyle={{ padding: 20 }} testID="add-student-form">
      <View style={styles.headerRow}>
        <Ionicons name="person-add" size={22} color="#1565c0" />
        <Text style={styles.headerText}>إضافة طالب جديد</Text>
      </View>

      {contextLabel ? (
        <View style={styles.contextBox}>
          <Text style={styles.contextText}>{contextLabel}</Text>
        </View>
      ) : null}

      <Text style={styles.label}>رقم القيد *</Text>
      <TextInput
        value={values.student_id}
        onChangeText={(v) => set({ student_id: v })}
        placeholder="مثل: 1001"
        style={styles.input}
        testID="add-student-id-input"
      />

      <Text style={[styles.label, styles.mt10]}>الاسم الكامل *</Text>
      <TextInput
        value={values.full_name}
        onChangeText={(v) => set({ full_name: v })}
        placeholder="مثل: أحمد علي السعدي"
        style={styles.input}
        testID="add-student-name-input"
      />

      {mode === 'standalone' && (
        <>
          <Text style={[styles.label, styles.mt10]}>القسم *</Text>
          <View style={styles.pickerWrap}>
            <Picker
              selectedValue={values.department_id}
              onValueChange={(v) => set({ department_id: String(v) })}
              style={styles.picker}
              testID="add-student-dept-picker"
            >
              <Picker.Item label="-- اختر القسم --" value="" />
              {departments.map((d) => (
                <Picker.Item key={d.id} label={d.name} value={d.id} />
              ))}
            </Picker>
          </View>

          <View style={styles.row}>
            <View style={styles.col}>
              <Text style={styles.label}>المستوى *</Text>
              <View style={styles.pickerWrap}>
                <Picker
                  selectedValue={values.level}
                  onValueChange={(v) => set({ level: String(v) })}
                  style={styles.picker}
                  testID="add-student-level-picker"
                >
                  {[1,2,3,4,5,6,7,8].map(lv => (
                    <Picker.Item key={lv} label={`المستوى ${lv}`} value={String(lv)} />
                  ))}
                </Picker>
              </View>
            </View>
            <View style={styles.col}>
              <Text style={styles.label}>الشعبة (اختياري)</Text>
              <TextInput
                value={values.section}
                onChangeText={(v) => set({ section: v })}
                placeholder="اتركها فارغة لو لا توجد"
                style={styles.input}
                testID="add-student-section-input"
              />
            </View>
          </View>
        </>
      )}

      <View style={[styles.row, styles.mt10]}>
        <View style={styles.col}>
          <Text style={styles.label}>رمز البرنامج (اختياري)</Text>
          <TextInput
            value={values.program_code}
            onChangeText={(v) => set({ program_code: v.toUpperCase() })}
            placeholder="افتراضي من القسم"
            autoCapitalize="characters"
            maxLength={3}
            style={styles.input}
            testID="add-student-program-input"
          />
        </View>
        <View style={styles.col}>
          <Text style={styles.label}>عام الالتحاق (اختياري)</Text>
          <TextInput
            value={values.enrollment_year}
            onChangeText={(v) => set({ enrollment_year: v.replace(/[^0-9]/g, '') })}
            placeholder="25 أو 2025"
            keyboardType="numeric"
            maxLength={4}
            style={styles.input}
            testID="add-student-year-input"
          />
        </View>
      </View>

      <View style={styles.infoBox}>
        <Text style={styles.infoText}>
          💡 الرقم المرجعي يُولَّد تلقائياً من <Text style={{ fontWeight: '700' }}>رمز البرنامج + عام الالتحاق + الكلية</Text>.
          اتركهما فارغين لاستخدام القيم الافتراضية من القسم/المستوى.
        </Text>
      </View>

      <Text style={[styles.label, styles.mt10]}>الجنسية (اختياري — الافتراضي: يمني)</Text>
      <TextInput
        value={values.nationality}
        onChangeText={(v) => set({ nationality: v })}
        placeholder="يمني"
        style={styles.input}
        testID="add-student-nationality-input"
      />

      <Text style={[styles.label, styles.mt10]}>الجوال (اختياري)</Text>
      <TextInput
        value={values.phone}
        onChangeText={(v) => set({ phone: v })}
        placeholder="مثل: 7xxxxxxxx"
        keyboardType="phone-pad"
        style={styles.input}
      />

      <Text style={[styles.label, styles.mt10]}>البريد الإلكتروني (اختياري)</Text>
      <TextInput
        value={values.email}
        onChangeText={(v) => set({ email: v })}
        placeholder="example@mail.com"
        keyboardType="email-address"
        autoCapitalize="none"
        style={styles.input}
      />

      <Text style={[styles.label, styles.mt10]}>كلمة المرور (اختياري — افتراضياً = رقم القيد)</Text>
      <TextInput
        value={values.password}
        onChangeText={(v) => set({ password: v })}
        placeholder="اتركها فارغة لاستخدام رقم القيد"
        style={styles.input}
      />

      <View style={styles.btnRow}>
        <TouchableOpacity
          style={[styles.btn, styles.btnCancel]}
          onPress={onCancel}
          disabled={submitting}
          testID="add-student-cancel-btn"
        >
          <Text style={styles.btnText}>إلغاء</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary, { opacity: submitting ? 0.6 : 1 }]}
          onPress={onSubmit}
          disabled={submitting}
          testID="confirm-add-student-btn"
        >
          <Text style={styles.btnText}>
            {submitting ? 'جاري الإضافة...' : (submitLabel || 'إضافة')}
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, gap: 10 },
  headerText: { fontSize: 17, fontWeight: '700', color: '#1565c0' },
  contextBox: { backgroundColor: '#e8f5e9', padding: 10, borderRadius: 8, marginBottom: 12 },
  contextText: { fontSize: 12, color: '#2e7d32', textAlign: 'right', fontWeight: '600' },
  label: { fontSize: 13, fontWeight: '600', color: '#37474f', marginBottom: 6, textAlign: 'right' },
  mt10: { marginTop: 10 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10, fontSize: 14, backgroundColor: '#fafafa', textAlign: 'right' },
  pickerWrap: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, backgroundColor: '#fafafa', overflow: 'hidden' },
  picker: { height: 44 },
  row: { flexDirection: 'row', gap: 10, marginTop: 10 },
  col: { flex: 1 },
  infoBox: { backgroundColor: '#e3f2fd', padding: 10, borderRadius: 8, marginTop: 10 },
  infoText: { fontSize: 11, color: '#0d47a1', textAlign: 'right', lineHeight: 18 },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  btnCancel: { backgroundColor: '#9e9e9e' },
  btnPrimary: { backgroundColor: '#1565c0' },
  btnText: { color: '#fff', fontWeight: '700' },
});
