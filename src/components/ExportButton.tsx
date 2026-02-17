import React from 'react';
import { TouchableOpacity, ActivityIndicator, Alert, Platform, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

interface ExportButtonProps {
  onExport: () => Promise<any>;
  filename: string;
  disabled?: boolean;
  color?: string;
}

export const ExportButton: React.FC<ExportButtonProps> = ({
  onExport,
  filename,
  disabled = false,
  color = '#4caf50'
}) => {
  const [exporting, setExporting] = React.useState(false);

  const handleExport = async () => {
    try {
      setExporting(true);
      const response = await onExport();
      
      if (Platform.OS === 'web') {
        const blob = new Blob([response.data], { 
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
        });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        window.URL.revokeObjectURL(url);
      } else {
        const fileUri = `${FileSystem.documentDirectory}${filename}`;
        
        // تحويل البيانات إلى base64
        const reader = new FileReader();
        const blob = new Blob([response.data]);
        
        reader.onloadend = async () => {
          const base64 = (reader.result as string).split(',')[1];
          await FileSystem.writeAsStringAsync(fileUri, base64, {
            encoding: FileSystem.EncodingType.Base64,
          });
          await Sharing.shareAsync(fileUri, {
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            dialogTitle: 'تصدير التقرير',
          });
        };
        reader.readAsDataURL(blob);
      }
      
      Alert.alert('نجاح', 'تم تصدير التقرير بنجاح');
    } catch (error) {
      console.error('Export error:', error);
      Alert.alert('خطأ', 'فشل في تصدير التقرير');
    } finally {
      setExporting(false);
    }
  };

  return (
    <TouchableOpacity
      style={styles.exportBtn}
      onPress={handleExport}
      disabled={disabled || exporting}
    >
      {exporting ? (
        <ActivityIndicator size="small" color={color} />
      ) : (
        <Ionicons 
          name="download-outline" 
          size={24} 
          color={disabled ? '#ccc' : color} 
        />
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  exportBtn: {
    padding: 4,
  },
});
