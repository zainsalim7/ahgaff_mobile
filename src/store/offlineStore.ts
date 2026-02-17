import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { OfflineAttendance } from '../types';
import * as uuid from 'expo-crypto';

interface OfflineState {
  pendingAttendance: OfflineAttendance[];
  isOnline: boolean;
  setOnline: (status: boolean) => void;
  addOfflineAttendance: (record: Omit<OfflineAttendance, 'local_id' | 'synced'>) => Promise<void>;
  markAsSynced: (localIds: string[]) => Promise<void>;
  loadPendingAttendance: () => Promise<void>;
  clearSynced: () => Promise<void>;
}

const STORAGE_KEY = 'offline_attendance';

export const useOfflineStore = create<OfflineState>((set, get) => ({
  pendingAttendance: [],
  isOnline: true,

  setOnline: (status: boolean) => set({ isOnline: status }),

  addOfflineAttendance: async (record) => {
    const newRecord: OfflineAttendance = {
      ...record,
      local_id: `offline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      synced: false,
    };

    const current = get().pendingAttendance;
    const updated = [...current, newRecord];
    
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    set({ pendingAttendance: updated });
  },

  markAsSynced: async (localIds: string[]) => {
    const current = get().pendingAttendance;
    const updated = current.map(r => 
      localIds.includes(r.local_id) ? { ...r, synced: true } : r
    );
    
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    set({ pendingAttendance: updated });
  },

  loadPendingAttendance: async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        set({ pendingAttendance: JSON.parse(stored) });
      }
    } catch (error) {
      console.error('Error loading offline attendance:', error);
    }
  },

  clearSynced: async () => {
    const current = get().pendingAttendance;
    const unsynced = current.filter(r => !r.synced);
    
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(unsynced));
    set({ pendingAttendance: unsynced });
  },
}));
