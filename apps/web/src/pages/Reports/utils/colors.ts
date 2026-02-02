// RAG status colors for Recharts
export const RAG_COLORS = {
  red: '#ef4444',
  amber: '#f59e0b',
  green: '#22c55e',
} as const

// Brand / chart palette
export const CHART_COLORS = {
  primary: '#6366f1',    // indigo-500
  primaryLight: '#a5b4fc', // indigo-300
  secondary: '#8b5cf6',  // violet-500
  tertiary: '#06b6d4',   // cyan-500
  quaternary: '#f97316',  // orange-500
  gray: '#9ca3af',       // gray-400
  grayLight: '#e5e7eb',  // gray-200
  blue: '#3b82f6',
  teal: '#14b8a6',
  pink: '#ec4899',
} as const

// Sequential palette for multi-series charts
export const SERIES_COLORS = [
  CHART_COLORS.primary,
  CHART_COLORS.secondary,
  CHART_COLORS.tertiary,
  CHART_COLORS.quaternary,
  CHART_COLORS.blue,
  CHART_COLORS.teal,
  CHART_COLORS.pink,
  RAG_COLORS.green,
  RAG_COLORS.amber,
  RAG_COLORS.red,
]

// Funnel-specific colors (green to red gradient)
export const FUNNEL_COLORS = [
  '#6366f1', // created - indigo
  '#3b82f6', // inspected - blue
  '#06b6d4', // priced - cyan
  '#14b8a6', // sent - teal
  '#22c55e', // opened - green
  '#84cc16', // authorized - lime
]
