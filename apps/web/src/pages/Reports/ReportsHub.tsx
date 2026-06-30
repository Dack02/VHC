import { Link } from 'react-router-dom'
import {
  BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, Line,
} from 'recharts'
import { useReportFilters } from './hooks/useReportFilters'
import { useReportData } from './hooks/useReportData'
import StatCard from './components/StatCard'
import ChartCard from './components/ChartCard'
import ReportFiltersBar from './components/ReportFiltersBar'
import ExportButton from './components/ExportButton'
import { formatCurrency, formatPercent, formatNumber, formatDate, trendDirection, trendPercent } from './utils/formatters'
import { CHART_COLORS, FUNNEL_COLORS } from './utils/colors'
import { useModules } from '../../contexts/ModulesContext'
import type { ModuleKey } from '../../lib/modules'

// Report cards gated behind a non-default module (hidden until the module is on).
const REPORT_CARD_MODULE: Record<string, ModuleKey> = {
  '/reports/social-media': 'social_media',
}

interface SummaryData {
  period: { from: string; to: string }
  summary: {
    total: number
    completed: number
    sent: number
    authorized: number
    declined: number
    pending: number
    conversionRate: number
    totalValueIdentified: number
    totalValueAuthorized: number
    totalValueDeclined: number
  }
  chartData: Array<{
    period: string
    total: number
    completed: number
    authorized: number
    declined: number
    value: number
  }>
  technicianMetrics: Array<{ id: string; name: string; total: number; completed: number }>
  advisorMetrics: Array<{ id: string; name: string; total: number; sent: number; authorized: number; conversionRate: number; totalValue: number }>
  previousPeriod?: {
    total: number
    completed: number
    sent: number
    authorized: number
    totalValueIdentified: number
    totalValueAuthorized: number
    conversionRate: number
  }
}

interface NavCard {
  to: string
  title: string
  description: string
  icon: React.ReactNode
}

const navCards: NavCard[] = [
  {
    to: '/reports/daily-overview',
    title: 'Overview Report',
    description: 'Performance, revenue, conversion',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    to: '/reports/online-vhc',
    title: 'Online VHC Performance',
    description: 'Red/amber auth rate when sent online — self-serve vs chased — open/response funnel, by advisor',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
    ),
  },
  {
    to: '/reports/social-media',
    title: 'Social Media Analytics',
    description: 'Reach, engagement, follower growth & ad spend across Facebook, Instagram & TikTok',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
      </svg>
    ),
  },
  {
    to: '/reports/financial',
    title: 'Financial',
    description: 'Revenue, margins, parts vs labour',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    to: '/reports/items',
    title: 'Item Performance',
    description: 'Usage, red/amber split, revenue per inspection item',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
      </svg>
    ),
  },
  {
    to: '/reports/repair-types',
    title: 'Repair Types',
    description: 'Revenue, conversion & work-mix by repair type; brand/fuel slice',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085" />
      </svg>
    ),
  },
  {
    to: '/reports/parts-gp',
    title: 'Parts Gross Profit',
    description: 'Parts margin (sell − cost) by repair type',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
      </svg>
    ),
  },
  {
    to: '/reports/stock-valuation',
    title: 'Stock Valuation',
    description: 'Current inventory asset (qty × average cost) by category',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
      </svg>
    ),
  },
  {
    to: '/reports/low-stock',
    title: 'Low Stock',
    description: 'Stocked items at or below their reorder point',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
      </svg>
    ),
  },
  {
    to: '/reports/stock-movements',
    title: 'Stock Movements',
    description: 'Audit trail of receipts, issues and adjustments',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
      </svg>
    ),
  },
  {
    to: '/reports/parts-on-order',
    title: 'Parts on Order',
    description: 'Open PO lines awaiting delivery, by supplier',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
  },
  {
    to: '/reports/negative-stock',
    title: 'Negative Stock',
    description: 'Stocked items issued below zero to reconcile',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 12H6" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    to: '/reports/parts-to-return',
    title: 'Parts to Return',
    description: 'Unused or declined order-in parts to send back',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
      </svg>
    ),
  },
  {
    to: '/reports/orphan-parts',
    title: 'Orphan Parts',
    description: 'Ordered or received but never on a job card',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
      </svg>
    ),
  },
  {
    to: '/reports/slow-moving',
    title: 'Slow-Moving Stock',
    description: 'Dead stock with capital tied up and no recent movement',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    to: '/reports/received-not-invoiced',
    title: 'Received, Not Invoiced',
    description: 'Stock in from factors with no supplier invoice yet',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    to: '/reports/technicians',
    title: 'Technicians',
    description: 'KPIs, inspection times, quality',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    to: '/reports/advisors',
    title: 'Advisors',
    description: 'Conversion, pricing speed, revenue',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    to: '/reports/customers',
    title: 'Customers',
    description: 'Engagement, decline analysis',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
  },
  {
    to: '/reports/operations',
    title: 'Operations',
    description: 'Bottlenecks, turnaround, throughput',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    to: '/reports/capacity-utilisation',
    title: 'Capacity Utilisation',
    description: 'Booked vs available hours vs target',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 13a9 9 0 1018 0 9 9 0 00-18 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 13l4-3" />
      </svg>
    ),
  },
  {
    to: '/reports/compliance',
    title: 'Quality & Compliance',
    description: 'Brake disc, MRI, audit trail',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
  },
  {
    to: '/reports/deferred',
    title: 'Deferred Work',
    description: 'Deferred items, due dates, follow-ups',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    to: '/reports/follow-up-recovery',
    title: 'Follow-Up Recovery',
    description: 'Future deferred-work pipeline and recovery rate',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
      </svg>
    ),
  },
  {
    to: '/reports/outreach-bookings',
    title: 'Bookings from Outreach',
    description: 'Bookings & revenue recovered by the Follow-Up module',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
      </svg>
    ),
  },
  {
    to: '/reports/mri-performance',
    title: 'MRI Performance',
    description: 'Scan outcomes, flag rates, revenue',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
  },
  {
    to: '/reports/deleted-health-checks',
    title: 'Deleted Health Checks',
    description: 'Deletions, reasons, accountability',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>
    ),
  },
]

// Ordered sub-sections for the Detailed Reports area. Cards are matched by
// route, so the card definitions above stay untouched; any report not listed
// here falls into a trailing "Other" group so nothing disappears when new
// reports are added.
const reportGroups: { title: string; routes: string[] }[] = [
  {
    title: 'Overview & Financial',
    routes: ['/reports/daily-overview', '/reports/financial'],
  },
  {
    title: 'Sales & Conversion',
    routes: ['/reports/online-vhc', '/reports/items', '/reports/repair-types', '/reports/mri-performance'],
  },
  {
    title: 'Marketing & Channels',
    routes: ['/reports/social-media'],
  },
  {
    title: 'Parts & Stock',
    routes: [
      '/reports/parts-gp',
      '/reports/stock-valuation',
      '/reports/low-stock',
      '/reports/stock-movements',
      '/reports/parts-on-order',
      '/reports/negative-stock',
      '/reports/parts-to-return',
      '/reports/orphan-parts',
      '/reports/slow-moving',
      '/reports/received-not-invoiced',
    ],
  },
  {
    title: 'Team & Customers',
    routes: ['/reports/technicians', '/reports/advisors', '/reports/customers'],
  },
  {
    title: 'Operations & Compliance',
    routes: ['/reports/operations', '/reports/capacity-utilisation', '/reports/compliance'],
  },
  {
    title: 'Follow-Up & Recovery',
    routes: ['/reports/deferred', '/reports/follow-up-recovery', '/reports/outreach-bookings'],
  },
  {
    title: 'Audit',
    routes: ['/reports/deleted-health-checks'],
  },
]

export default function ReportsHub() {
  const {
    filters, queryString,
    setDatePreset, setCustomDateRange, setGroupBy, setSiteId,
  } = useReportFilters()
  const { isEnabled } = useModules()
  const cardVisible = (route: string) => !REPORT_CARD_MODULE[route] || isEnabled(REPORT_CARD_MODULE[route])

  const { data, loading, error } = useReportData<SummaryData>({
    endpoint: '/api/v1/reports',
    queryString,
  })

  const s = data?.summary
  const prev = data?.previousPeriod

  // Build funnel data from summary
  const funnelData = s ? [
    { name: 'Created', value: s.total },
    { name: 'Completed', value: s.completed },
    { name: 'Sent', value: s.sent },
    { name: 'Authorized', value: s.authorized },
  ].filter(d => d.value > 0) : []

  // Chart data formatted for display
  const chartData = data?.chartData.map(d => ({
    ...d,
    label: formatDate(d.period),
  })) || []

  // Revenue chart data
  const revenueData = data?.chartData.map(d => ({
    label: formatDate(d.period),
    authorized: d.value,
    total: d.total,
  })) || []

  const captureRate = s && s.totalValueIdentified > 0
    ? (s.totalValueAuthorized / s.totalValueIdentified) * 100
    : 0

  // Bucket the report cards into their configured sub-sections (cards keep the
  // order in which routes are listed), then append any unassigned reports under
  // "Other" so newly added reports always show up somewhere.
  const reportSections = reportGroups
    .map(group => ({
      title: group.title,
      cards: group.routes
        .filter(cardVisible)
        .map(route => navCards.find(card => card.to === route))
        .filter((card): card is NavCard => card !== undefined),
    }))
    .filter(group => group.cards.length > 0)

  const groupedRoutes = new Set(reportGroups.flatMap(g => g.routes))
  const ungroupedReports = navCards.filter(card => !groupedRoutes.has(card.to) && cardVisible(card.to))
  if (ungroupedReports.length > 0) {
    reportSections.push({ title: 'Other', cards: ungroupedReports })
  }

  const renderReportCard = (card: NavCard) => (
    <Link
      key={card.to}
      to={card.to}
      className="block bg-white border border-gray-200 rounded-xl p-5 hover:border-primary hover:shadow-sm transition-all"
    >
      <div className="flex items-start space-x-4">
        <div className="flex-shrink-0 text-gray-400">{card.icon}</div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-900">{card.title}</h3>
          <p className="text-xs text-gray-500 mt-1">{card.description}</p>
        </div>
        <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </Link>
  )

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          <p className="text-gray-500 text-sm mt-1">Executive overview and analytics</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton
            endpoint="/api/v1/reports/export"
            queryString={queryString}
            filename={`reports-${new Date().toISOString().split('T')[0]}.csv`}
          />
        </div>
      </div>

      {/* Filters */}
      <ReportFiltersBar
        datePreset={filters.datePreset}
        groupBy={filters.groupBy}
        siteId={filters.siteId}
        customDateFrom={filters.customFrom}
        customDateTo={filters.customTo}
        onDatePresetChange={setDatePreset}
        onCustomDateRange={setCustomDateRange}
        onGroupByChange={setGroupBy}
        onSiteChange={setSiteId}
      />

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : (
        <>
          {/* Stat Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <StatCard
              label="Health Checks"
              value={formatNumber(s?.total || 0)}
              trend={prev ? { direction: trendDirection(s?.total || 0, prev.total), percent: trendPercent(s?.total || 0, prev.total) } : undefined}
            />
            <StatCard
              label="Completion Rate"
              value={s && s.total > 0 ? formatPercent((s.completed / s.total) * 100) : '0%'}
              valueClassName="text-primary"
            />
            <StatCard
              label="Conversion Rate"
              value={formatPercent(s?.conversionRate || 0)}
              valueClassName="text-primary"
              trend={prev ? { direction: trendDirection(s?.conversionRate || 0, prev.conversionRate), percent: trendPercent(s?.conversionRate || 0, prev.conversionRate) } : undefined}
            />
            <StatCard
              label="Revenue Authorized"
              value={formatCurrency(s?.totalValueAuthorized || 0)}
              valueClassName="text-green-600"
              trend={prev ? { direction: trendDirection(s?.totalValueAuthorized || 0, prev.totalValueAuthorized), percent: trendPercent(s?.totalValueAuthorized || 0, prev.totalValueAuthorized) } : undefined}
            />
            <StatCard
              label="Revenue Identified"
              value={formatCurrency(s?.totalValueIdentified || 0)}
            />
            <StatCard
              label="Capture Rate"
              value={formatPercent(captureRate)}
              valueClassName={captureRate >= 50 ? 'text-green-600' : captureRate >= 30 ? 'text-amber-600' : 'text-red-600'}
            />
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Health Check Volume */}
            <ChartCard title="Health Check Volume">
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="total" name="Total" fill={CHART_COLORS.grayLight} radius={[4, 4, 0, 0]} />
                  <Line dataKey="authorized" name="Authorized" stroke={CHART_COLORS.primary} strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Revenue Trend */}
            <ChartCard title="Revenue Trend">
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={revenueData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `£${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                  <Area
                    type="monotone"
                    dataKey="authorized"
                    name="Authorized"
                    stroke={CHART_COLORS.primary}
                    fill={CHART_COLORS.primaryLight}
                    fillOpacity={0.3}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Conversion Funnel */}
          {funnelData.length > 0 && (
            <ChartCard title="Conversion Funnel">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={funnelData} layout="vertical" barCategoryGap="20%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={80} />
                  <Tooltip />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {funnelData.map((_, index) => (
                      <rect key={index} fill={FUNNEL_COLORS[index % FUNNEL_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}

          {/* Navigation — grouped into sections */}
          <div>
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Detailed Reports</h2>
            {reportSections.map(section => (
              <div key={section.title} className="mb-8 last:mb-0">
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">{section.title}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {section.cards.map(renderReportCard)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
