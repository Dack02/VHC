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

export function jobPath(job: JobRef): string {
  return job.jobsheetId
    ? `/jobsheets/${job.jobsheetId}`
    : `/health-checks/${job.healthCheckId}`
}

// "job card" when the job has one, else "health check" — for button labels.
export function jobRecordLabel(job: JobRef): string {
  return job.jobsheetId ? 'job card' : 'health check'
}
