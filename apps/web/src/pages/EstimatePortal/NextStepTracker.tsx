/**
 * "What happens next" tracker for the estimate portal. Sets the expectation that booking is
 * the next step BEFORE the customer approves. Purely presentational.
 */
import { UspIcon } from '../../lib/uspIcons'

export type TrackerStep = 'approve' | 'book' | 'work'

const STEPS: { key: TrackerStep; label: string }[] = [
  { key: 'approve', label: 'Approve work' },
  { key: 'book', label: 'Book your slot' },
  { key: 'work', label: 'We do the work' }
]

/**
 * @param current  the step the customer is ON (everything before it is done).
 * @param brand    tenant brand colour for the active accents.
 */
export default function NextStepTracker({ current, brand = '#1b5e54' }: { current: TrackerStep; brand?: string }) {
  const currentIdx = STEPS.findIndex((s) => s.key === current)
  const tint = `color-mix(in srgb, ${brand} 12%, #ffffff)`

  return (
    <div className="bg-gray-50 border border-gray-100 rounded-2xl p-5">
      <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-gray-400 mb-4">What happens next</div>

      <div className="flex items-center px-1">
        {STEPS.map((step, i) => {
          const done = i < currentIdx
          const active = i === currentIdx
          return (
            <div key={step.key} className="contents">
              <span
                className="w-[30px] h-[30px] rounded-full flex items-center justify-center shrink-0 text-[13px] font-extrabold"
                style={
                  done
                    ? { background: brand, color: '#fff' }
                    : active
                    ? { background: '#fff', border: `2px solid ${brand}`, color: brand, boxShadow: `0 0 0 4px ${tint}` }
                    : { background: '#fff', border: '2px solid #dfe3e0', color: '#b6bcc2' }
                }
              >
                {done ? <UspIcon name="check" size={15} /> : i + 1}
              </span>
              {i < STEPS.length - 1 && (
                <span className="flex-1 h-[2px]" style={{ background: i < currentIdx ? brand : '#dfe3e0' }} />
              )}
            </div>
          )
        })}
      </div>

      <div className="flex mt-2.5">
        {STEPS.map((step, i) => (
          <span
            key={step.key}
            className="flex-1 text-[11px] font-bold"
            style={{
              textAlign: i === 0 ? 'left' : i === STEPS.length - 1 ? 'right' : 'center',
              color: i <= currentIdx ? brand : '#b6bcc2'
            }}
          >
            {step.label}
          </span>
        ))}
      </div>

      {current === 'approve' && (
        <div className="mt-3.5 rounded-xl border px-3 py-2.5 flex items-center gap-2.5" style={{ background: tint, borderColor: `color-mix(in srgb, ${brand} 22%, #ffffff)` }}>
          <span style={{ color: brand }} className="shrink-0"><UspIcon name="calendar" size={17} /></span>
          <span className="text-[12px] font-semibold leading-snug" style={{ color: `color-mix(in srgb, ${brand} 72%, #102420)` }}>
            Once you approve, you’ll pick a date that suits you — no need to call.
          </span>
        </div>
      )}
    </div>
  )
}
