import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { authAPI } from '../src/services/api';
import { useAuthStore } from '../src/store/authStore';

export default function ChangePasswordScreen() {
  const router = useRouter();
  const { user, setUser } = useAuthStore();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const isForced = user?.must_change_password === true;

  const handleChangePassword = async () => {
    if (!newPassword || !confirmPassword) {
      Alert.alert('خطأ', 'الرجاء ملء جميع الحقول');
      return;
    }

    if (newPassword.length < 6) {
      Alert.alert('خطأ', 'كلمة المرور يجب أن تكون 6 أحرف على الأقل');
      return;
    }

    if (newPassword !== confirmPassword) {
      Alert.alert('خطأ', 'كلمتا المرور غير متطابقتين');
      return;
    }

    if (newPassword === user?.username) {
      Alert.alert('خطأ', 'كلمة المرور لا يمكن أن تكون نفس الرقم الجامعي');
      return;
    }

    setLoading(true);
    try {
      await authAPI.forceChangePassword(newPassword);
      
      if (user) {
        setUser({ ...user, must_change_password: false });
      }

      Alert.alert('تم بنجاح ✅', 'تم تغيير كلمة المرور', [
        {
          text: 'متابعة',
          onPress: () => {
            if (user?.role === 'student') {
              router.replace('/(tabs)');
            } else {
              router.replace('/');
            }
          },
        },
      ]);
    } catch (error: any) {
      const message = error.response?.data?.detail || 'فشل في تغيير كلمة المرور';
      Alert.alert('خطأ', message);
    } finally {
      setLoading(false);
    }
  };

  const isValid = newPassword.length >= 6 && 
                  newPassword !== user?.username && 
                  newPassword === confirmPassword;

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.content}
      >
        <ScrollView 
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.iconContainer}>
              <Ionicons name="key" size={32} color="#fff" />
            </View>
            <Text style={styles.title}>تغيير كلمة المرور</Text>
            {isForced && (
              <Text style={styles.subtitle}>يجب تغيير كلمة المرور للمتابعة</Text>
            )}
          </View>

          {/* Form */}
          <View style={styles.form}>
            {/* Info Box */}
            <View style={styles.infoBox}>
              <Ionicons name="information-circle" size={18} color="#1565c0" />
              <Text style={styles.infoText}>
                اختر كلمة مرور جديدة (6 أحرف على الأقل)
              </Text>
            </View>

            {/* New Password */}
            <Text style={styles.label}>كلمة المرور الجديدة</Text>
            <View style={styles.inputContainer}>
              <Ionicons name="lock-closed" size={18} color="#666" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                value={newPassword}
                onChangeText={setNewPassword}
                placeholder="أدخل كلمة المرور"
                placeholderTextColor="#999"
                secureTextEntry={!showPassword}
                autoCapitalize="none"
              />
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                <Ionicons name={showPassword ? "eye-off" : "eye"} size={18} color="#666" />
              </TouchableOpacity>
            </View>

            {/* Confirm Password */}
            <Text style={styles.label}>تأكيد كلمة المرور</Text>
            <View style={styles.inputContainer}>
              <Ionicons name="lock-closed" size={18} color="#666" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="أعد إدخال كلمة المرور"
                placeholderTextColor="#999"
                secureTextEntry={!showPassword}
                autoCapitalize="none"
              />
            </View>

            {/* Requirements */}
            <View style={styles.requirements}>
              <View style={styles.reqItem}>
                <Ionicons 
                  name={newPassword.length >= 6 ? "checkmark-circle" : "ellipse-outline"} 
                  size={14} 
                  color={newPassword.length >= 6 ? "#4caf50" : "#999"} 
                />
                <Text style={[styles.reqText, newPassword.length >= 6 && styles.reqMet]}>
                  6 أحرف على الأقل
                </Text>
              </View>
              <View style={styles.reqItem}>
                <Ionicons 
                  name={newPassword && newPassword !== user?.username ? "checkmark-circle" : "ellipse-outline"} 
                  size={14} 
                  color={newPassword && newPassword !== user?.username ? "#4caf50" : "#999"} 
                />
                <Text style={[styles.reqText, newPassword && newPassword !== user?.username && styles.reqMet]}>
                  مختلفة عن الرقم الجامعي
                </Text>
              </View>
              <View style={styles.reqItem}>
                <Ionicons 
                  name={confirmPassword && newPassword === confirmPassword ? "checkmark-circle" : "ellipse-outline"} 
                  size={14} 
                  color={confirmPassword && newPassword === confirmPassword ? "#4caf50" : "#999"} 
                />
                <Text style={[styles.reqText, confirmPassword && newPassword === confirmPassword && styles.reqMet]}>
                  تطابق كلمتي المرور
                </Text>
              </View>
            </View>

            {/* Submit Button */}
            <TouchableOpacity
              style={[styles.button, (!isValid || loading) && styles.buttonDisabled]}
              onPress={handleChangePassword}
              disabled={!isValid || loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={20} color="#fff" />
                  <Text style={styles.buttonText}>تغيير كلمة المرور</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1565c0',
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  header: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 20,
  },
  iconContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.8)',
    textAlign: 'center',
  },
  form: {
    flex: 1,
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: '#e3f2fd',
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
    alignItems: 'center',
    gap: 8,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: '#1565c0',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
    marginBottom: 6,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  inputIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 15,
    textAlign: 'right',
  },
  requirements: {
    backgroundColor: '#f9f9f9',
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
  },
  reqItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  reqText: {
    fontSize: 13,
    color: '#666',
  },
  reqMet: {
    color: '#4caf50',
  },
  button: {
    flexDirection: 'row',
    backgroundColor: '#4caf50',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonDisabled: {
    backgroundColor: '#bdbdbd',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});
