/**
 * Decorative, blurred recreation of the app (the Health Checks kanban) shown behind
 * the auth cards on /login, /signup and /auth/callback — so signing in feels like
 * stepping into the product. Pure CSS, so there's no screenshot asset to keep in sync
 * and it themes with the app's colours. Purely cosmetic: aria-hidden + pointer-events-none.
 *
 * To use a real screenshot instead, drop a PNG in /public and replace the inner faux-app
 * markup with <img src="/your-screenshot.png" className="h-full w-full object-cover" />.
 */
const COLUMNS = [
  { dot: 'bg-blue-500', cards: 3 },
  { dot: 'bg-amber-400', cards: 2 },
  { dot: 'bg-green-500', cards: 1 },
  { dot: 'bg-purple-500', cards: 1 },
  { dot: 'bg-gray-400', cards: 2 },
]

function FauxCard() {
  return (
    <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-3 space-y-2">
      <div className="h-3.5 w-16 rounded bg-gray-800/80" />
      <div className="h-2.5 w-28 rounded bg-gray-200" />
      <div className="h-2.5 w-20 rounded bg-gray-100" />
      <div className="flex gap-1.5 pt-1">
        <span className="h-2 w-2 rounded-full bg-rag-red" />
        <span className="h-2 w-2 rounded-full bg-rag-amber" />
        <span className="h-2 w-2 rounded-full bg-rag-green" />
      </div>
    </div>
  )
}

export default function AuthBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden select-none">
      {/* Faux app screenshot, blurred and slightly scaled so blur edges stay off-screen */}
      <div className="absolute inset-0 origin-top-left scale-[1.02] blur-[3px]">
        {/* Top bar */}
        <div className="h-14 bg-white border-b border-gray-200 flex items-center px-6 gap-4">
          <div className="h-5 w-28 rounded bg-primary/70" />
          <div className="ml-auto h-7 w-24 rounded-full bg-gray-100" />
          <div className="h-7 w-7 rounded-full bg-gray-100" />
        </div>

        <div className="flex h-[calc(100%-3.5rem)]">
          {/* Sidebar */}
          <div className="hidden sm:flex w-56 flex-col gap-2 bg-white border-r border-gray-200 p-4">
            <div className="h-8 rounded-lg bg-primary/15" />
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="h-7 rounded-lg bg-gray-100" />
            ))}
          </div>

          {/* Kanban board */}
          <div className="flex-1 p-6 bg-gray-50">
            <div className="h-7 w-48 rounded bg-gray-200 mb-5" />
            <div className="flex gap-4">
              {COLUMNS.map((col, i) => (
                <div key={i} className="w-64 shrink-0">
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`h-2.5 w-2.5 rounded-full ${col.dot}`} />
                    <div className="h-4 w-28 rounded bg-gray-200" />
                  </div>
                  <div className="space-y-3">
                    {Array.from({ length: col.cards }).map((_, j) => (
                      <FauxCard key={j} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Legibility scrim so the card and its text stay crisp on top */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/55 via-white/45 to-indigo-200/45" />
    </div>
  )
}
