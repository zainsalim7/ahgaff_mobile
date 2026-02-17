import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { studentsAPI, attendanceAPI } from '../src/services/api';
import { useOfflineStore } from '../src/store/offlineStore';

export default function QRScannerScreen() {
  const router = useRouter();
  const { courseId, courseName } = useLocalSearchParams();
  const { isOnline, addOfflineAttendance } = useOfflineStore();
  
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [scannedStudents, setScannedStudents] = useState<string[]>([]);

  const handleBarCodeScanned = async ({ data }: { data: string }) => {
    if (scanned || data === lastScanned) return;
    
    setScanned(true);
    setLastScanned(data);

    try {
      // Get student by QR code
      const studentRes = await studentsAPI.getByQR(data);
      const student = studentRes.data;

      if (scannedStudents.includes(student.id)) {
        Alert.alert('تنبيه', `${student.full_name} تم تسجيله مسبقاً`, [
          { text: 'حسناً', onPress: () => setScanned(false) }
        ]);
        return;
      }

      // Record attendance
      if (isOnline) {
        await attendanceAPI.recordSingle({
          course_id: courseId as string,
          student_id: student.id,
          status: 'present',
          method: 'qr',
        });
      } else {
        await addOfflineAttendance({
          course_id: courseId as string,
          student_id: student.id,
          status: 'present',
          date: new Date().toISOString(),
          method: 'qr',
        });
      }

      setScannedStudents([...scannedStudents, student.id]);
      
      Alert.alert('تم التسجيل', `تم تسجيل حضور: ${student.full_name}`, [
        { text: 'متابعة', onPress: () => setScanned(false) }
      ]);
    } catch (error: any) {
      const message = error.response?.data?.detail || 'لم يتم العثور على الطالب';
      Alert.alert('خطأ', message, [
        { text: 'حسناً', onPress: () => setScanned(false) }
      ]);
    }
  };

  if (!permission) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>جاري التحقق من الصلاحيات...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.permissionContainer}>
          <Ionicons name="camera-outline" size={64} color="#999" />
          <Text style={styles.message}>نحتاج إذن الوصول للكاميرا</Text>
          <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
            <Text style={styles.permissionButtonText}>منح الإذن</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{
          barcodeTypes: ['qr'],
        }}
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
      >
        <View style={styles.overlay}>
          <View style={styles.header}>
            <Text style={styles.headerText}>{courseName}</Text>
            <Text style={styles.subHeaderText}>
              تم مسح: {scannedStudents.length} طالب
            </Text>
          </View>

          <View style={styles.scanFrame}>
            <View style={[styles.corner, styles.topLeft]} />
            <View style={[styles.corner, styles.topRight]} />
            <View style={[styles.corner, styles.bottomLeft]} />
            <View style={[styles.corner, styles.bottomRight]} />
          </View>

          <View style={styles.instructions}>
            <Ionicons name="qr-code" size={24} color="#fff" />
            <Text style={styles.instructionText}>
              وجّه الكاميرا نحو رمز QR الخاص بالطالب
            </Text>
          </View>

          <TouchableOpacity
            style={styles.doneButton}
            onPress={() => router.back()}
          >
            <Ionicons name="checkmark-circle" size={24} color="#fff" />
            <Text style={styles.doneButtonText}>انتهاء</Text>
          </TouchableOpacity>
        </View>
      </CameraView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'space-between',
    padding: 20,
  },
  header: {
    alignItems: 'center',
    paddingTop: 40,
  },
  headerText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  subHeaderText: {
    fontSize: 16,
    color: '#4caf50',
    marginTop: 8,
  },
  scanFrame: {
    width: 250,
    height: 250,
    alignSelf: 'center',
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderColor: '#1565c0',
  },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
  },
  instructions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
  },
  instructionText: {
    color: '#fff',
    fontSize: 16,
    marginLeft: 12,
  },
  doneButton: {
    backgroundColor: '#4caf50',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
  },
  doneButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  message: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#f5f5f5',
  },
  permissionButton: {
    backgroundColor: '#1565c0',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 16,
  },
  permissionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
