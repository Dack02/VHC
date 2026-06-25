/**
 * Lightweight screenshot annotator: draw freehand highlight strokes over a
 * captured/uploaded image before attaching it to a feedback report. Returns a
 * composited JPEG data URL. Mouse + touch via pointer events.
 */

import { useEffect, useRef, useState } from 'react'

interface Stroke {
  color: string
  points: Array<{ x: number; y: number }>
}

const COLORS = [
  { label: 'Red', value: '#ef4444' },
  { label: 'Amber', value: '#f59e0b' },
  { label: 'Blue', value: '#3b82f6' },
]
const MAX_WIDTH = 640

export default function ScreenshotAnnotator({
  imageUrl,
  onSave,
  onCancel,
}: {
  imageUrl: string
  onSave: (dataUrl: string) => void
  onCancel: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [color, setColor] = useState(COLORS[0].value)
  const [drawing, setDrawing] = useState(false)
  const [ready, setReady] = useState(false)

  // Load the image, size the canvas to fit, and do the first paint.
  useEffect(() => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      imgRef.current = img
      const canvas = canvasRef.current
      if (!canvas) return
      const scale = Math.min(1, MAX_WIDTH / img.naturalWidth)
      canvas.width = Math.round(img.naturalWidth * scale)
      canvas.height = Math.round(img.naturalHeight * scale)
      setReady(true)
    }
    img.src = imageUrl
  }, [imageUrl])

  // Repaint image + strokes whenever strokes change.
  useEffect(() => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img || !ready) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    ctx.lineWidth = 4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const stroke of strokes) {
      ctx.strokeStyle = stroke.color
      ctx.beginPath()
      stroke.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
      ctx.stroke()
    }
  }, [strokes, ready])

  function pointFrom(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/80 p-4" data-feedback-ignore="true">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h3 className="text-base font-medium text-gray-900">Annotate screenshot</h3>
          <div className="flex items-center gap-2">
            {COLORS.map((cl) => (
              <button
                key={cl.value}
                onClick={() => setColor(cl.value)}
                className={`h-6 w-6 rounded-full border-2 ${color === cl.value ? 'border-gray-900' : 'border-transparent'}`}
                style={{ backgroundColor: cl.value }}
                aria-label={cl.label}
              />
            ))}
            <button
              onClick={() => setStrokes((s) => s.slice(0, -1))}
              className="rounded-lg px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
            >
              Undo
            </button>
            <button
              onClick={() => setStrokes([])}
              className="rounded-lg px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center overflow-auto bg-gray-100 p-4">
          <canvas
            ref={canvasRef}
            className="max-w-full cursor-crosshair touch-none rounded shadow"
            onPointerDown={(e) => {
              ;(e.target as HTMLCanvasElement).setPointerCapture(e.pointerId)
              setDrawing(true)
              setStrokes((s) => [...s, { color, points: [pointFrom(e)] }])
            }}
            onPointerMove={(e) => {
              if (!drawing) return
              const p = pointFrom(e)
              setStrokes((s) => {
                const next = s.slice()
                next[next.length - 1] = { ...next[next.length - 1], points: [...next[next.length - 1].points, p] }
                return next
              })
            }}
            onPointerUp={() => setDrawing(false)}
          />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-4 py-3">
          <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100">
            Cancel
          </button>
          <button
            onClick={() => {
              const canvas = canvasRef.current
              if (canvas) onSave(canvas.toDataURL('image/jpeg', 0.85))
            }}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Save annotation
          </button>
        </div>
      </div>
    </div>
  )
}
