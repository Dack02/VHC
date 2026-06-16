/**
 * Automated-comms suppression switch.
 *
 * When SUPPRESS_AUTOMATED_COMMS is truthy, AUTOMATED / scheduled comms are
 * skipped: the follow-up sweep, scheduled reminders, the daily SMS overview
 * digest, and the library gap report digest. MANUAL and TEST sends are NOT
 * affected — advisor conversation SMS, the Super Admin "Test SMS/Email" buttons,
 * the per-org follow-up "send test", "send health check to customer", and the
 * manual "send now" digest endpoints all continue to send normally.
 *
 * Intended for the dev environment, where the database is cloned from production
 * so customer/staff contact details are real — nothing should get auto-messaged.
 * Default OFF, so production behaviour is unchanged.
 *
 * Note: the follow-up engine also honours its own FOLLOW_UP_DRY_RUN flag; this
 * switch additionally forces that engine into dry-run.
 */
export function suppressAutomatedComms(): boolean {
  const v = (process.env.SUPPRESS_AUTOMATED_COMMS || '').trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes' || v === 'on'
}
