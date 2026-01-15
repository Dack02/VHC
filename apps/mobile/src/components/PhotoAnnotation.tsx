import { useState, useRef, useEffect } from 'react'
import { Button } from './Button'

type Tool = 'draw' | 'arrow' | 'circle' | 'box'

interface AnnotationData {
  imageData: string
  annotations: string // SVG overlay as string
}

interface PhotoAnnotationProps {
  imageUrl: string
  onSave: (data: AnnotationData) => void
  onClose: () => void
}

export function PhotoAnnotation({ imageUrl, onSave, onClose }: PhotoAnnotationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [tool, setTool] = useState<Tool>('draw')
  const [isDrawing, setIsDrawing] = useState(false)
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null)
  const [paths, setPaths] = useState<string[]>([])
  const [currentPath, setCurrentPath] = useState<string>('')
  const [imageLoaded, setImageLoaded] = useState(false)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (containerRef.current) {
        const container = containerRef.current
        const maxWidth = container.clientWidth
        const maxHeight = container.clientHeight

        let width = img.width
        let height = img.height

        // Scale to fit
        if (width > maxWidth) {
          height = (maxWidth / width) * height
          width = maxWidth
        }
        if (height > maxHeight) {
          width = (maxHeight / height) * width
          height = maxHeight
        }

        setDimensions({ width, height })
        setImageLoaded(true)

        // Draw image on canvas
        if (canvasRef.current) {
          const canvas = canvasRef.current
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height)
          }
        }
      }
    }
    img.src = imageUrl
  }, [imageUrl])

  const getCoords = (e: React.TouchEvent | React.MouseEvent) => {
    if (!canvasRef.current) return { x: 0, y: 0 }

    const rect = canvasRef.current.getBoundingClientRect()
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY

    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    }
  }

  const handleStart = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault()
    setIsDrawing(true)
    const coords = getCoords(e)
    setStartPoint(coords)

    if (tool === 'draw') {
      setCurrentPath(`M ${coords.x} ${coords.y}`)
    }
  }

  const handleMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!isDrawing || !startPoint) return
    e.preventDefault()

    const coords = getCoords(e)

    if (tool === 'draw') {
      setCurrentPath((prev) => `${prev} L ${coords.x} ${coords.y}`)
    }
  }

  const handleEnd = (e: React.TouchEvent | React.MouseEvent) => {
    if (!isDrawing || !startPoint) return
    e.preventDefault()

    const coords = getCoords(e)
    let newPath = ''

    switch (tool) {
      case 'draw':
        newPath = currentPath
        break
      case 'arrow':
        newPath = createArrowPath(startPoint, coords)
        break
      case 'circle':
        newPath = createCirclePath(startPoint, coords)
        break
      case 'box':
        newPath = createBoxPath(startPoint, coords)
        break
    }

    if (newPath) {
      setPaths((prev) => [...prev, newPath])
    }

    setIsDrawing(false)
    setStartPoint(null)
    setCurrentPath('')
  }

  const createArrowPath = (start: { x: number; y: number }, end: { x: number; y: number }) => {
    const angle = Math.atan2(end.y - start.y, end.x - start.x)
    const headLength = 20

    const arrowHead1 = {
      x: end.x - headLength * Math.cos(angle - Math.PI / 6),
      y: end.y - headLength * Math.sin(angle - Math.PI / 6)
    }
    const arrowHead2 = {
      x: end.x - headLength * Math.cos(angle + Math.PI / 6),
      y: end.y - headLength * Math.sin(angle + Math.PI / 6)
    }

    return `M ${start.x} ${start.y} L ${end.x} ${end.y} M ${end.x} ${end.y} L ${arrowHead1.x} ${arrowHead1.y} M ${end.x} ${end.y} L ${arrowHead2.x} ${arrowHead2.y}`
  }

  const createCirclePath = (start: { x: number; y: number }, end: { x: number; y: number }) => {
    const cx = (start.x + end.x) / 2
    const cy = (start.y + end.y) / 2
    const rx = Math.abs(end.x - start.x) / 2
    const ry = Math.abs(end.y - start.y) / 2

    return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy}`
  }

  const createBoxPath = (start: { x: number; y: number }, end: { x: number; y: number }) => {
    return `M ${start.x} ${start.y} L ${end.x} ${start.y} L ${end.x} ${end.y} L ${start.x} ${end.y} Z`
  }

  const handleUndo = () => {
    setPaths((prev) => prev.slice(0, -1))
  }

  const handleClear = () => {
    setPaths([])
  }

  const handleSave = () => {
    if (!canvasRef.current) return

    // Create SVG with annotations
    const svgContent = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${dimensions.width}" height="${dimensions.height}">
        ${paths.map((path) => `<path d="${path}" fill="none" stroke="#dc2626" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}
      </svg>
    `

    // Composite image with annotations
    const canvas = document.createElement('canvas')
    canvas.width = dimensions.width
    canvas.height = dimensions.height
    const ctx = canvas.getContext('2d')

    if (ctx && canvasRef.current) {
      // Draw original image
      ctx.drawImage(canvasRef.current, 0, 0)

      // Draw annotations
      const img = new Image()
      const svgBlob = new Blob([svgContent], { type: 'image/svg+xml' })
      const url = URL.createObjectURL(svgBlob)

      img.onload = () => {
        ctx.drawImage(img, 0, 0)
        URL.revokeObjectURL(url)

        const compositeImage = canvas.toDataURL('image/jpeg', 0.85)
        onSave({
          imageData: compositeImage,
          annotations: svgContent
        })
      }
      img.src = url
    }
  }

  const tools: { id: Tool; label: string; icon: JSX.Element }[] = [
    {
      id: 'draw',
      label: 'Draw',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
        </svg>
      )
    },
    {
      id: 'arrow',
      label: 'Arrow',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
        </svg>
      )
    },
    {
      id: 'circle',
      label: 'Circle',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" strokeWidth={2} />
        </svg>
      )
    },
    {
      id: 'box',
      label: 'Box',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <rect x="4" y="4" width="16" height="16" strokeWidth={2} />
        </svg>
      )
    }
  ]

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      {/* Header */}
      <div className="bg-gray-900 px-4 py-3 flex items-center justify-between">
        <button onClick={onClose} className="text-white p-2">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <span className="text-white font-medium">Annotate Photo</span>
        <div className="flex gap-2">
          <button onClick={handleUndo} className="text-white p-2" disabled={paths.length === 0}>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
          </button>
          <button onClick={handleClear} className="text-white p-2" disabled={paths.length === 0}>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Canvas area */}
      <div ref={containerRef} className="flex-1 flex items-center justify-center bg-gray-800 overflow-hidden">
        {imageLoaded && (
          <div className="relative" style={{ width: dimensions.width, height: dimensions.height }}>
            <canvas ref={canvasRef} className="absolute inset-0" />

            {/* SVG overlay for annotations */}
            <svg
              className="absolute inset-0"
              style={{ width: dimensions.width, height: dimensions.height }}
              onTouchStart={handleStart}
              onTouchMove={handleMove}
              onTouchEnd={handleEnd}
              onMouseDown={handleStart}
              onMouseMove={handleMove}
              onMouseUp={handleEnd}
              onMouseLeave={handleEnd}
            >
              {/* Existing paths */}
              {paths.map((path, idx) => (
                <path
                  key={idx}
                  d={path}
                  fill="none"
                  stroke="#dc2626"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}

              {/* Current path being drawn */}
              {currentPath && (
                <path
                  d={currentPath}
                  fill="none"
                  stroke="#dc2626"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </svg>
          </div>
        )}
      </div>

      {/* Tools */}
      <div className="bg-gray-900 p-4 safe-area-inset-bottom">
        <div className="flex justify-center gap-4 mb-4">
          {tools.map((t) => (
            <button
              key={t.id}
              className={`
                p-3 rounded
                ${tool === t.id ? 'bg-primary text-white' : 'bg-gray-700 text-gray-300'}
              `}
              onClick={() => setTool(t.id)}
            >
              {t.icon}
            </button>
          ))}
        </div>

        <Button fullWidth size="lg" onClick={handleSave}>
          Save Annotation
        </Button>
      </div>
    </div>
  )
}
