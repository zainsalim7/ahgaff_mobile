import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { studentsAPI, departmentsAPI } from '../src/services/api';
import { LoadingScreen } from '../src/components/LoadingScreen';
import { Student, Department } from '../src/types';

export default function StudentCardScreen() {
  const { studentId } = useLocalSearchParams();
  const [student, setStudent] = useState<Student | null>(null);
  const [department, setDepartment] = useState<Department | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, [studentId]);

  const fetchData = async () => {
    try {
      const studentRes = await studentsAPI.getById(studentId as string);
      setStudent(studentRes.data);
      
      const deptsRes = await departmentsAPI.getAll();
      const dept = deptsRes.data.find((d: Department) => d.id === studentRes.data.department_id);
      setDepartment(dept || null);
    } catch (error) {
      console.error('Error fetching student:', error);
      Alert.alert('خطأ', 'فشل في تحميل بيانات الطالب');
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    if (Platform.OS === 'web') {
      window.print();
    } else {
      Alert.alert(
        'طباعة البطاقة',
        'لطباعة البطاقة، يرجى أخذ لقطة شاشة أو استخدام النسخة الويب',
        [{ text: 'حسناً' }]
      );
    }
  };

  if (loading) {
    return <LoadingScreen />;
  }

  if (!student) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={64} color="#f44336" />
          <Text style={styles.errorText}>الطالب غير موجود</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Student Card */}
        <View style={styles.card}>
          {/* Header */}
          <View style={styles.cardHeader}>
            <Text style={styles.collegeName}>كلية الشريعة والقانون</Text>
            <Text style={styles.cardTitle}>بطاقة الطالب</Text>
          </View>

          {/* QR Code */}
          <View style={styles.qrContainer}>
            <QRCode
              value={student.qr_code}
              size={180}
              backgroundColor="#fff"
              color="#1565c0"
            />
          </View>

          {/* Student Info */}
          <View style={styles.infoSection}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>الاسم:</Text>
              <Text style={styles.infoValue}>{student.full_name}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>رقم الطالب:</Text>
              <Text style={styles.infoValue}>{student.student_id}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>القسم:</Text>
              <Text style={styles.infoValue}>{department?.name || 'غير محدد'}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>المستوى:</Text>
              <Text style={styles.infoValue}>المستوى {student.level}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>الشعبة:</Text>
              <Text style={styles.infoValue}>{student.section}</Text>
            </View>
          </View>

          {/* Footer */}
          <View style={styles.cardFooter}>
            <Text style={styles.footerText}>هذه البطاقة للتحضير في المحاضرات</Text>
            <Text style={styles.qrCodeText}>{student.qr_code}</Text>
          </View>
        </View>

        {/* Print Button */}
        <TouchableOpacity style={styles.printButton} onPress={handlePrint}>
          <Ionicons name="print" size={24} color="#fff" />
          <Text style={styles.printButtonText}>طباعة البطاقة</Text>
        </TouchableOpacity>

        {/* Instructions */}
        <View style={styles.instructions}>
          <Text style={styles.instructionsTitle}>تعليمات:</Text>
          <Text style={styles.instructionText}>• احتفظ بهذه البطاقة معك دائماً</Text>
          <Text style={styles.instructionText}>• أظهرها للمعلم عند بدء المحاضرة</Text>
          <Text style={styles.instructionText}>• لا تشارك البطاقة مع الآخرين</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollContent: {
    padding: 16,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  cardHeader: {
    backgroundColor: '#1565c0',
    padding: 20,
    alignItems: 'center',
  },
  collegeName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  cardTitle: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.9)',
    marginTop: 4,
  },
  qrContainer: {
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  infoSection: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  infoLabel: {
    fontSize: 14,
    color: '#666',
    fontWeight: '600',
  },
  infoValue: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
  },
  cardFooter: {
    backgroundColor: '#f5f5f5',
    padding: 16,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 12,
    color: '#666',
  },
  qrCodeText: {
    fontSize: 10,
    color: '#999',
    marginTop: 4,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  printButton: {
    flexDirection: 'row',
    backgroundColor: '#4caf50',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  printButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  instructions: {
    backgroundColor: '#fff3e0',
    padding: 16,
    borderRadius: 12,
    marginTop: 16,
  },
  instructionsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#f57c00',
    marginBottom: 8,
  },
  instructionText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 18,
    color: '#666',
    marginTop: 16,
  },
});
