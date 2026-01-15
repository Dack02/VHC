import { useState, useRef, useEffect } from 'react'
import { Button } from './Button'

interface PhotoCaptureProps {
  onCapture: (photoData: string) => void
  onClose: () => void
}

export function PhotoCapture({ onCapture, onClose }: PhotoCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [capturedImage, setCapturedImage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cameraReady, setCameraReady] = useState(false)
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment')

  useEffect(() => {
    startCamera()

    return () => {
      stopCamera()
    }
  }, [facingMode])

  const startCamera = async () => {
    try {
      stopCamera()
      setCameraReady(false)

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facingMode,
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      })

      setStream(mediaStream)

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream
        videoRef.current.onloadedmetadata = () => {
          setCameraReady(true)
        }
      }

      setError(null)
    } catch (err) {
      console.error('Camera error:', err)
      setError('Unable to access camera. You can upload a photo from your gallery instead.')
    }
  }

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop())
      setStream(null)
    }
  }

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return

    const video = videoRef.current
    const canvas = canvasRef.current
    const context = canvas.getContext('2d')

    if (!context) return

    // Set canvas size to video dimensions
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight

    // Draw the video frame
    context.drawImage(video, 0, 0)

    // Get image data as base64
    const imageData = canvas.toDataURL('image/jpeg', 0.85)
    setCapturedImage(imageData)

    // Haptic feedback
    if ('vibrate' in navigator) {
      navigator.vibrate(100)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const imageData = event.target?.result as string
      setCapturedImage(imageData)
    }
    reader.readAsDataURL(file)
  }

  const openGallery = () => {
    fileInputRef.current?.click()
  }

  const retake = () => {
    setCapturedImage(null)
    if (!error) {
      startCamera()
    }
  }

  const confirmPhoto = () => {
    if (capturedImage) {
      onCapture(capturedImage)
    }
  }

  const switchCamera = () => {
    setFacingMode((prev) => (prev === 'user' ? 'environment' : 'user'))
  }

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      {/* Hidden file input for gallery */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Camera view or preview */}
      <div className="flex-1 relative overflow-hidden">
        {capturedImage ? (
          <img
            src={capturedImage}
            alt="Captured"
            className="w-full h-full object-contain"
          />
        ) : error ? (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
            <div className="text-center text-white p-6 max-w-sm">
              <svg className="w-16 h-16 mx-auto mb-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <p className="text-gray-300 mb-6">{error}</p>
              <div className="flex flex-col gap-3">
                <Button onClick={openGallery} fullWidth size="lg">
                  Upload from Gallery
                </Button>
                <Button onClick={startCamera} variant="secondary" fullWidth>
                  Try Camera Again
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
        )}

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 left-4 w-10 h-10 bg-black/50 text-white flex items-center justify-center rounded-full"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Switch camera button (only if camera is working) */}
        {!capturedImage && !error && (
          <button
            onClick={switchCamera}
            className="absolute top-4 right-4 w-10 h-10 bg-black/50 text-white flex items-center justify-center rounded-full"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        )}
      </div>

      {/* Hidden canvas for capturing */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Controls */}
      <div className="bg-black p-4 safe-area-inset-bottom">
        {capturedImage ? (
          <div className="flex gap-4">
            <Button
              variant="secondary"
              onClick={retake}
              fullWidth
              size="lg"
            >
              Retake
            </Button>
            <Button
              onClick={confirmPhoto}
              fullWidth
              size="lg"
            >
              Use Photo
            </Button>
          </div>
        ) : !error ? (
          <div className="flex items-center justify-center gap-6">
            {/* Gallery button */}
            <button
              onClick={openGallery}
              className="w-12 h-12 bg-gray-800 text-white rounded-full flex items-center justify-center"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </button>

            {/* Capture button */}
            <button
              onClick={capturePhoto}
              disabled={!cameraReady}
              className="w-20 h-20 rounded-full bg-white border-4 border-gray-300
                         flex items-center justify-center
                         active:scale-95 transition-transform
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="w-16 h-16 rounded-full bg-white border-2 border-gray-400" />
            </button>

            {/* Spacer for balance */}
            <div className="w-12 h-12" />
          </div>
        ) : null}
      </div>
    </div>
  )
}
