// Where a "job" opens to. A booking can be a plain health check (VHC) or a job
// card (jobsheet) from the GMS module with a VHC attached. When a parent job card
// exists, the job opens the job card — the VHC is reached from inside it. Plain
// DMS/manual checks (no jobsheet) open the VHC directly.
//
// Keep every job list/board on this helper so the routing stays consistent.

export interface JobRef {
  jobsheetId?: string | null
  healthCheckId?: string | null
}

// `tab` deep-links a shared tab that exists on BOTH the job card and the VHC
// (overview / checkin / mri / work). Don't pass a VHC-only tab (e.g. notes) when
// the job may be a job card — there's no such tab there.
export function jobPath(job: JobRef, opts?: { tab?: string }): string {
  const base = job.jobsheetId
    ? `/jobsheets/${job.jobsheetId}`
    : `/health-checks/${job.healthCheckId}`
  return opts?.tab ? `${base}?tab=${opts.tab}` : base
}

// "job card" when the job has one, else "health check" — for button labels.
export function jobRecordLabel(job: JobRef): string {
  return job.jobsheetId ? 'job card' : 'health check'
}
