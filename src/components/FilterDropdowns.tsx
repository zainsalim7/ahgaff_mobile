import React from 'react';
import { View, Text, TextInput, StyleSheet, Platform } from 'react-native';
import { Picker } from '@react-native-picker/picker';

const LEVELS = ['1', '2', '3', '4', '5'];

interface Department {
  id: string;
  name: string;
}

interface FilterDropdownsProps {
  departments: Department[];
  selectedDept: string;
  setSelectedDept: (value: string) => void;
  selectedLevel: string;
  setSelectedLevel: (value: string) => void;
  selectedSection?: string;
  setSelectedSection?: (value: string) => void;
  showAllOption?: boolean;
  deptLabel?: string;
  levelLabel?: string;
  sectionLabel?: string;
  required?: boolean;
}

export const FilterDropdowns: React.FC<FilterDropdownsProps> = ({
  departments,
  selectedDept,
  setSelectedDept,
  selectedLevel,
  setSelectedLevel,
  selectedSection = '',
  setSelectedSection,
  showAllOption = true,
  deptLabel = 'القسم',
  levelLabel = 'المستوى',
  sectionLabel = 'الشعبة',
  required = false,
}) => {
  return (
    <View style={styles.dropdownRow}>
      <View style={styles.dropdownContainer}>
        <Text style={styles.dropdownLabel}>{deptLabel}{required ? ' *' : ''}</Text>
        <View style={styles.pickerWrapper}>
          <Picker
            selectedValue={selectedDept}
            onValueChange={(value) => setSelectedDept(value)}
            style={styles.picker}
          >
            {showAllOption ? (
              <Picker.Item label="الكل" value="" />
            ) : (
              <Picker.Item label="اختر..." value="" />
            )}
            {departments.map(dept => (
              <Picker.Item key={dept.id} label={dept.name} value={dept.id} />
            ))}
          </Picker>
        </View>
      </View>
      
      <View style={styles.dropdownContainer}>
        <Text style={styles.dropdownLabel}>{levelLabel}{required ? ' *' : ''}</Text>
        <View style={styles.pickerWrapper}>
          <Picker
            selectedValue={selectedLevel}
            onValueChange={(value) => setSelectedLevel(value)}
            style={styles.picker}
          >
            {showAllOption && <Picker.Item label="الكل" value="" />}
            {LEVELS.map(level => (
              <Picker.Item key={level} label={`م${level}`} value={level} />
            ))}
          </Picker>
        </View>
      </View>
      
      {setSelectedSection && (
        <View style={styles.dropdownContainer}>
          <Text style={styles.dropdownLabel}>{sectionLabel}</Text>
          <TextInput
            style={styles.dropdownInput}
            value={selectedSection}
            onChangeText={setSelectedSection}
            placeholder={showAllOption ? "الكل" : "اختياري"}
          />
        </View>
      )}
    </View>
  );
};

// للنماذج (Forms) - بدون خيار "الكل"
interface FormDropdownsProps {
  departments: Department[];
  selectedDept: string;
  setSelectedDept: (value: string) => void;
  selectedLevel: string;
  setSelectedLevel: (value: string) => void;
  selectedSection?: string;
  setSelectedSection?: (value: string) => void;
  teachers?: { id: string; full_name: string }[];
  selectedTeacher?: string;
  setSelectedTeacher?: (value: string) => void;
}

export const FormDropdowns: React.FC<FormDropdownsProps> = ({
  departments,
  selectedDept,
  setSelectedDept,
  selectedLevel,
  setSelectedLevel,
  selectedSection = '',
  setSelectedSection,
  teachers,
  selectedTeacher = '',
  setSelectedTeacher,
}) => {
  return (
    <View style={styles.formContainer}>
      <View style={styles.formRow}>
        <View style={styles.formDropdown}>
          <Text style={styles.formLabel}>القسم *</Text>
          <View style={styles.pickerWrapper}>
            <Picker
              selectedValue={selectedDept}
              onValueChange={(value) => setSelectedDept(value)}
              style={styles.picker}
            >
              <Picker.Item label="اختر القسم..." value="" />
              {departments.map(dept => (
                <Picker.Item key={dept.id} label={dept.name} value={dept.id} />
              ))}
            </Picker>
          </View>
        </View>
        
        <View style={styles.formDropdown}>
          <Text style={styles.formLabel}>المستوى *</Text>
          <View style={styles.pickerWrapper}>
            <Picker
              selectedValue={selectedLevel}
              onValueChange={(value) => setSelectedLevel(value)}
              style={styles.picker}
            >
              {LEVELS.map(level => (
                <Picker.Item key={level} label={`م${level}`} value={level} />
              ))}
            </Picker>
          </View>
        </View>
      </View>
      
      <View style={styles.formRow}>
        {setSelectedSection && (
          <View style={styles.formDropdown}>
            <Text style={styles.formLabel}>الشعبة</Text>
            <TextInput
              style={styles.formInput}
              value={selectedSection}
              onChangeText={setSelectedSection}
              placeholder="اختياري"
            />
          </View>
        )}
        
        {teachers && setSelectedTeacher && (
          <View style={styles.formDropdown}>
            <Text style={styles.formLabel}>المعلم *</Text>
            <View style={styles.pickerWrapper}>
              <Picker
                selectedValue={selectedTeacher}
                onValueChange={(value) => setSelectedTeacher(value)}
                style={styles.picker}
              >
                <Picker.Item label="اختر المعلم..." value="" />
                {teachers.map(teacher => (
                  <Picker.Item key={teacher.id} label={teacher.full_name} value={teacher.id} />
                ))}
              </Picker>
            </View>
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  dropdownRow: {
    flexDirection: 'row',
    gap: 8,
  },
  dropdownContainer: {
    flex: 1,
  },
  dropdownLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  pickerWrapper: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    overflow: 'hidden',
  },
  picker: {
    height: 45,
    fontSize: 13,
  },
  dropdownInput: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    paddingHorizontal: 10,
    paddingVertical: 12,
    fontSize: 13,
    height: 45,
  },
  formContainer: {
    gap: 12,
  },
  formRow: {
    flexDirection: 'row',
    gap: 12,
  },
  formDropdown: {
    flex: 1,
  },
  formLabel: {
    fontSize: 13,
    color: '#333',
    marginBottom: 6,
    fontWeight: '500',
  },
  formInput: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    height: 45,
  },
});

export default FilterDropdowns;
