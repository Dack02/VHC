import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react'
import { useAuth } from './AuthContext'
import { api } from '../lib/api'

interface OrganizationBranding {
  // Branding
  logoUrl: string | null
  logoDarkUrl: string | null
  faviconUrl: string | null
  primaryColor: string | null
  secondaryColor: string | null
  // Business Info
  organizationName: string
  legalName: string | null
  // Contact
  phone: string | null
  email: string | null
  website: string | null
  // Address
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  county: string | null
  postcode: string | null
  country: string | null
}

interface BrandingContextType {
  branding: OrganizationBranding | null
  loading: boolean
  error: string | null
  refreshBranding: () => Promise<void>
  // Computed CSS variables
  cssVariables: Record<string, string>
}

const defaultBranding: OrganizationBranding = {
  logoUrl: null,
  logoDarkUrl: null,
  faviconUrl: null,
  primaryColor: '#3B82F6', // Default blue
  secondaryColor: '#10B981', // Default green
  organizationName: 'VHC',
  legalName: null,
  phone: null,
  email: null,
  website: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  county: null,
  postcode: null,
  country: null
}

const BrandingContext = createContext<BrandingContextType | undefined>(undefined)

export function BrandingProvider({ children }: { children: ReactNode }) {
  const { user, session } = useAuth()
  const [branding, setBranding] = useState<OrganizationBranding | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchBranding = useCallback(async () => {
    if (!session?.accessToken || !user?.organization?.id) {
      setBranding({
        ...defaultBranding,
        organizationName: user?.organization?.name || 'VHC'
      })
      setLoading(false)
      return
    }

    try {
      setError(null)
      const settings = await api<{
        logoUrl: string | null
        logoDarkUrl: string | null
        faviconUrl: string | null
        primaryColor: string | null
        secondaryColor: string | null
        legalName: string | null
        phone: string | null
        email: string | null
        website: string | null
        addressLine1: string | null
        addressLine2: string | null
        city: string | null
        county: string | null
        postcode: string | null
        country: string | null
      }>(`/api/v1/organizations/${user.organization.id}/settings`, {
        token: session.accessToken
      })

      setBranding({
        logoUrl: settings.logoUrl,
        logoDarkUrl: settings.logoDarkUrl,
        faviconUrl: settings.faviconUrl,
        primaryColor: settings.primaryColor || defaultBranding.primaryColor,
        secondaryColor: settings.secondaryColor || defaultBranding.secondaryColor,
        organizationName: user.organization.name,
        legalName: settings.legalName,
        phone: settings.phone,
        email: settings.email,
        website: settings.website,
        addressLine1: settings.addressLine1,
        addressLine2: settings.addressLine2,
        city: settings.city,
        county: settings.county,
        postcode: settings.postcode,
        country: settings.country
      })
    } catch (err) {
      console.error('Failed to fetch branding:', err)
      setError('Failed to load branding')
      // Use defaults on error
      setBranding({
        ...defaultBranding,
        organizationName: user?.organization?.name || 'VHC'
      })
    } finally {
      setLoading(false)
    }
  }, [session?.accessToken, user?.organization?.id, user?.organization?.name])

  useEffect(() => {
    fetchBranding()
  }, [fetchBranding])

  // Generate CSS variables from branding colors
  const cssVariables: Record<string, string> = {
    '--brand-primary': branding?.primaryColor || defaultBranding.primaryColor!,
    '--brand-secondary': branding?.secondaryColor || defaultBranding.secondaryColor!,
    '--brand-primary-hover': adjustBrightness(branding?.primaryColor || defaultBranding.primaryColor!, -15),
    '--brand-primary-light': adjustBrightness(branding?.primaryColor || defaultBranding.primaryColor!, 40)
  }

  // Apply CSS variables to document root
  useEffect(() => {
    const root = document.documentElement
    Object.entries(cssVariables).forEach(([key, value]) => {
      root.style.setProperty(key, value)
    })
  }, [cssVariables])

  // Update favicon if custom one is set
  useEffect(() => {
    if (branding?.faviconUrl) {
      const link = document.querySelector("link[rel~='icon']") as HTMLLinkElement
      if (link) {
        link.href = branding.faviconUrl
      } else {
        const newLink = document.createElement('link')
        newLink.rel = 'icon'
        newLink.href = branding.faviconUrl
        document.head.appendChild(newLink)
      }
    }
  }, [branding?.faviconUrl])

  return (
    <BrandingContext.Provider
      value={{
        branding,
        loading,
        error,
        refreshBranding: fetchBranding,
        cssVariables
      }}
    >
      {children}
    </BrandingContext.Provider>
  )
}

export function useBranding() {
  const context = useContext(BrandingContext)
  if (context === undefined) {
    throw new Error('useBranding must be used within a BrandingProvider')
  }
  return context
}

// Helper function to adjust color brightness
function adjustBrightness(hex: string, percent: number): string {
  // Remove # if present
  hex = hex.replace('#', '')

  // Parse RGB values
  let r = parseInt(hex.substring(0, 2), 16)
  let g = parseInt(hex.substring(2, 4), 16)
  let b = parseInt(hex.substring(4, 6), 16)

  // Adjust brightness
  r = Math.min(255, Math.max(0, r + (r * percent) / 100))
  g = Math.min(255, Math.max(0, g + (g * percent) / 100))
  b = Math.min(255, Math.max(0, b + (b * percent) / 100))

  // Convert back to hex
  return `#${Math.round(r).toString(16).padStart(2, '0')}${Math.round(g).toString(16).padStart(2, '0')}${Math.round(b).toString(16).padStart(2, '0')}`
}

// Export helper for getting formatted address
export function getFormattedAddress(branding: OrganizationBranding | null): string {
  if (!branding) return ''

  const parts = [
    branding.addressLine1,
    branding.addressLine2,
    branding.city,
    branding.county,
    branding.postcode,
    branding.country
  ].filter(Boolean)

  return parts.join(', ')
}
