interface HelpModalProps {
  onClose: () => void
}

interface Section {
  title: string
  body: React.ReactNode
}

const SECTIONS: Section[] = [
  {
    title: 'Two ways to view the board',
    body: (
      <>
        <strong>Job Status</strong> groups every job by stage: Due In → Checked In → In Workshop → your
        queue columns → Work Complete. <strong>Technicians</strong> groups by who's doing the work, with
        three layouts — <strong>▦ Cards</strong>, <strong>☰ Timeline</strong> (today's day planner) and
        <strong> ▥ Week</strong> (the week ahead).
      </>
    ),
  },
  {
    title: 'Moving jobs around',
    body: (
      <>
        Drag a card between columns to change its stage, or onto a technician to assign it. As you drag
        across columns the board makes room so you can see where it'll land. A job a technician is
        clocked onto can still be re-ordered, but can't be sent back to Checked In or Work Complete.
      </>
    ),
  },
  {
    title: 'Pre-booking (Due In)',
    body: (
      <>
        In the Technicians view (cards or timeline) you can drag a <strong>Due In</strong> booking onto a
        technician to pre-allocate it before the car arrives — it stays "Due In" until it's checked in.
      </>
    ),
  },
  {
    title: 'Planning a day (Timeline)',
    body: (
      <>
        Drag a job from the tray onto a technician's lane to give it a time — it snaps to the next free
        15-minute slot (a red "Day full" preview means there's no room before close). Drag a block's
        bottom edge to change the estimate. <strong>✨ Auto-arrange day</strong> drops the whole tray onto
        the first free slots; the <strong>⌖</strong> on a tray card finds just that one a slot. A
        <strong> "by HH:MM"</strong> tag and a red <strong>"won't be ready"</strong> flag warn when a job
        is scheduled to finish after the customer's promised time.
      </>
    ),
  },
  {
    title: 'Planning the week (Week)',
    body: (
      <>
        Technician rows × day columns. Drag jobs across days and technicians; the <strong>Day load</strong>
        footer shows how full each day is vs capacity. Click a day header (or a job) to open that day's
        timeline.
      </>
    ),
  },
  {
    title: 'Working hours & absence (🕑 Shifts)',
    body: (
      <>
        Set each technician's weekly hours and book holiday / sick / training days. Capacity and the week
        grid update automatically — days off are greyed out and over-booked days turn red.
      </>
    ),
  },
  {
    title: 'Statuses, queues & columns (+ Add column)',
    body: (
      <>
        Job statuses (e.g. Awaiting Parts, Ready for Collection) flag where a job is up to; some send the
        customer an SMS when set. Add a column for each technician, or a custom queue for a stage like
        Valeting or Quality Check.
      </>
    ),
  },
  {
    title: 'Efficiency & loading',
    body: (
      <>
        The <strong>Efficiency</strong> tile compares sold (estimated) vs actual clocked hours on
        completed jobs — over 100% means you're beating booked time. Each technician column shows their
        own figure, and the Technician Performance report breaks it down with utilisation.
      </>
    ),
  },
  {
    title: 'Filters, dates & screens',
    body: (
      <>
        Filter by advisor, technician, status, retail/internal, waiting or loan car; jump to any day with
        the date picker. <strong>📺 TV mode</strong> is an auto-cycling wall display, <strong>🖨 Print</strong>
        produces per-technician day sheets, and technicians get a <strong>My Day</strong> schedule in the
        mobile app.
      </>
    ),
  },
]

export default function HelpModal({ onClose }: HelpModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h3 className="text-base font-semibold text-gray-900">How the workshop board works</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none" aria-label="Close">×</button>
        </div>
        <div className="overflow-y-auto px-5 py-4 space-y-4">
          {SECTIONS.map(s => (
            <div key={s.title}>
              <h4 className="text-sm font-semibold text-gray-900 mb-0.5">{s.title}</h4>
              <p className="text-sm text-gray-600 leading-relaxed [&_strong]:font-semibold [&_strong]:text-gray-800">{s.body}</p>
            </div>
          ))}
        </div>
        <div className="px-5 py-3 border-t border-gray-200 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90">Got it</button>
        </div>
      </div>
    </div>
  )
}
