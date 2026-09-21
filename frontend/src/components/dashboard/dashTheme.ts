import { StyleSheet } from 'react-native';

export const DASH = {
  navy: '#0f2440',
  navy2: '#173a63',
  blue: '#1565c0',
  gold: '#d4a017',
  green: '#16a34a',
  red: '#dc2626',
  orange: '#f97316',
  purple: '#7c3aed',
  teal: '#0d9488',
  ink: '#0f172a',
  muted: '#64748b',
  line: '#e2e8f0',
  bg: '#f4f6fa',
  card: '#ffffff',
};

export const NUM_FONT = { fontFamily: 'system-ui, Arial, sans-serif' } as const;

export const dashStyles = StyleSheet.create({
  card: {
    backgroundColor: DASH.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: DASH.line,
    shadowColor: '#0f2440',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  sectionHead: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitleRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: DASH.ink, textAlign: 'right' },
  sectionSub: { fontSize: 11, color: DASH.muted, textAlign: 'right' },
  iconBox: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  linkBtn: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4 },
  linkText: { fontSize: 12, fontWeight: '700', color: DASH.blue },
  empty: { paddingVertical: 22, alignItems: 'center', gap: 6 },
  emptyText: { color: '#94a3b8', fontSize: 13 },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: '#f1f5f9' },
  chipText: { fontSize: 11, color: '#334155', fontWeight: '600' },
});
