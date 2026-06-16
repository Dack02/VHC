/**
 * Helpers for building the "set / reset password" links we email to users.
 *
 * WHY THIS EXISTS — email link prefetching.
 * Supabase's `generateLink` returns `properties.action_link`, which points at
 * `…/auth/v1/verify?token=…`. That endpoint consumes its single-use token on ANY
 * GET request. Mail-security gateways, browser link preloaders, and even a
 * click-then-reload will spend the token before the recipient can use it, leaving
 * them staring at "Email link is invalid or has expired".
 *
 * Instead of emailing that raw verify link, we point at our own /reset-password
 * page carrying the `token_hash`. The page only calls `verifyOtp()` when the user
 * submits their new password — so an automated fetch loads the form but never burns
 * the token. (This also makes the flow independent of the client's PKCE/implicit
 * flow config, since we never rely on the URL-hash session detection.)
 */

interface GenerateLinkProperties {
  hashed_token?: string | null
}

/**
 * Build a prefetch-safe password-setup link from a Supabase `generateLink` result's
 * `properties`. Returns `null` if the token hash is missing (caller should treat that
 * as a link-generation failure, same as a missing action_link previously).
 */
export function buildResetPasswordLink(
  properties: GenerateLinkProperties | null | undefined
): string | null {
  const tokenHash = properties?.hashed_token
  if (!tokenHash) return null
  const webUrl = process.env.WEB_URL || 'http://localhost:5181'
  return `${webUrl}/reset-password?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`
}
