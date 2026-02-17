import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface StatusBadgeProps {
  status: 'present' | 'absent' | 'late' | 'excused';
  size?: 'small' | 'medium' | 'large';
}

const statusConfig = {
  present: { label: 'حاضر', color: '#4caf50', bg: '#e8f5e9' },
  absent: { label: 'غائب', color: '#f44336', bg: '#ffebee' },
  late: { label: 'متأخر', color: '#ff9800', bg: '#fff3e0' },
  excused: { label: 'معذور', color: '#2196f3', bg: '#e3f2fd' },
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'medium' }) => {
  const config = statusConfig[status];
  const sizeStyles = {
    small: { paddingHorizontal: 8, paddingVertical: 2, fontSize: 10 },
    medium: { paddingHorizontal: 12, paddingVertical: 4, fontSize: 12 },
    large: { paddingHorizontal: 16, paddingVertical: 6, fontSize: 14 },
  };

  return (
    <View style={[styles.badge, { backgroundColor: config.bg }, sizeStyles[size]]}>
      <Text style={[styles.text, { color: config.color, fontSize: sizeStyles[size].fontSize }]}>
        {config.label}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  text: {
    fontWeight: '600',
  },
});
