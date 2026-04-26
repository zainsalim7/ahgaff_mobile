import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../src/store/authStore';
import { authAPI } from '../src/services/api';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LazyImage } from '../src/components/LazyImage';
import { markNavigationEnd } from '../src/utils/performanceUtils';

// شعار جامعة الأحقاف
const UNIVERSITY_LOGO = 'https://ahgaff.edu.ye/pluginfile.php/1/theme_lambda2/favicon/1769931878/University%20Logo.png';

export default function LoginScreen() {
  const router = useRouter();
  const setAuth = useAuthStore((state) => state.setAuth);
  
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [rememberMe, setRememberMe] = useState(false);

  useEffect(() => {
    initializeAdmin();
    loadSavedCredentials();
    // Mark that the login screen has finished its initial render
    markNavigationEnd('LoginScreen');
  }, []);

  const loadSavedCredentials = async () => {
    try {
      const saved = await AsyncStorage.getItem('saved_credentials');
      if (saved) {
        const { username: savedUser, password: savedPass } = JSON.parse(saved);
        setUsername(savedUser);
        setPassword(savedPass);
        setRememberMe(true);
      }
    } catch (e) {}
  };

  const initializeAdmin = async () => {
    try {
      // تحقق إذا سبق إعداد الأدمن (تخزين محلي)
      const alreadyInit = await AsyncStorage.getItem('admin_initialized');
      if (alreadyInit === 'true') {
        setInitialized(true);
        return;
      }
      await authAPI.initAdmin();
      await AsyncStorage.setItem('admin_initialized', 'true');
      setInitialized(true);
    } catch (error) {
      setInitialized(true);
    }
  };

  const showError = (message: string) => {
    setErrorMessage(message);
    if (Platform.OS !== 'web') {
      Alert.alert('خطأ', message);
    }
    setTimeout(() => setErrorMessage(''), 5000);
  };

  const handleLogin = async () => {
    setErrorMessage('');
    
    if (!username.trim() || !password.trim()) {
      showError('الرجاء إدخال اسم المستخدم وكلمة المرور');
      return;
    }

    setIsLoading(true);
    try {
      const response = await authAPI.login(username.trim(), password);
      const { access_token, user } = response.data;
      await setAuth(user, access_token);
      
      // حفظ البيانات إذا تم تفعيل "حفظ بياناتي"
      if (rememberMe) {
        await AsyncStorage.setItem('saved_credentials', JSON.stringify({ username: username.trim(), password }));
      } else {
        await AsyncStorage.removeItem('saved_credentials');
      }
      
      // حفظ بيانات الدخول للأوفلاين
      await AsyncStorage.setItem('offline_credentials', JSON.stringify({
        username: username.trim(),
        password,
        user,
        access_token,
      }));
      
      router.replace('/(tabs)');
    } catch (error: any) {
      // محاولة الدخول أوفلاين
      if (!error.response) {
        try {
          const offlineData = await AsyncStorage.getItem('offline_credentials');
          if (offlineData) {
            const { username: savedUser, password: savedPass, user, access_token } = JSON.parse(offlineData);
            if (username.trim() === savedUser && password === savedPass) {
              await setAuth(user, access_token);
              router.replace('/(tabs)');
              return;
            }
          }
          showError('لا يوجد اتصال بالإنترنت ولا توجد بيانات محفوظة');
        } catch (e) {
          showError('لا يوجد اتصال بالإنترنت');
        }
      } else {
        const message = error.response?.data?.detail || 'اسم المستخدم أو كلمة المرور غير صحيحة';
        showError(message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <View style={styles.logoContainer}>
              <LazyImage
                source={{ uri: UNIVERSITY_LOGO }}
                style={styles.logo}
                resizeMode="contain"
                alt="شعار جامعة الأحقاف"
              />
            </View>
            <Text style={styles.title}>جامعة الأحقاف</Text>
            <Text style={styles.subtitle}>نظام الحضور المركزي</Text>
          </View>

          <View style={styles.formContainer}>
            <View style={styles.inputContainer}>
              <Ionicons name="person" size={20} color="#666" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="اسم المستخدم"
                placeholderTextColor="#999"
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <View style={styles.inputContainer}>
              <Ionicons name="lock-closed" size={20} color="#666" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="كلمة المرور"
                placeholderTextColor="#999"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
                style={styles.eyeIcon}
              >
                <Ionicons
                  name={showPassword ? 'eye-off' : 'eye'}
                  size={20}
                  color="#666"
                />
              </TouchableOpacity>
            </View>

            {/* رسالة الخطأ */}
            {errorMessage !== '' && (
              <View style={styles.errorContainer}>
                <Ionicons name="alert-circle" size={20} color="#fff" />
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            )}

            {/* حفظ بياناتي */}
            <TouchableOpacity
              style={styles.rememberRow}
              onPress={() => setRememberMe(!rememberMe)}
              data-testid="remember-me-checkbox"
            >
              <Ionicons 
                name={rememberMe ? 'checkbox' : 'square-outline'} 
                size={22} 
                color={rememberMe ? '#1565c0' : '#888'} 
              />
              <Text style={styles.rememberText}>حفظ بياناتي</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.loginButton, isLoading && styles.loginButtonDisabled]}
              onPress={handleLogin}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.loginButtonText}>تسجيل الدخول</Text>
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
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logoContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    padding: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  logo: {
    width: 70,
    height: 70,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
  },
  formContainer: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  inputContainer: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    marginBottom: 16,
    paddingHorizontal: 12,
    height: 54,
  },
  inputIcon: {
    marginLeft: 8,
  },
  input: {
    flex: 1,
    height: 54,
    fontSize: 15,
    color: '#333',
    textAlign: 'right',
    writingDirection: 'rtl',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  rememberRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  rememberText: {
    fontSize: 14,
    color: '#555',
  },
  eyeIcon: {
    padding: 8,
  },
  loginButton: {
    backgroundColor: '#1565c0',
    borderRadius: 12,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  loginButtonDisabled: {
    opacity: 0.7,
  },
  loginButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f44336',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    gap: 8,
  },
  errorText: {
    color: '#fff',
    fontSize: 14,
    flex: 1,
  },
});
