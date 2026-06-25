/**
 * DMS booking detail — shared select + row→JSON mapping.
 *
 * One DMS-imported booking is a `health_checks` row (external_source 'gemini_osi',
 * status 'awaiting_arrival') carrying everything the Gemini import landed. Both the
 * Booking Diary (`/booking-diary/booking`) and the Follow-Up module
 * (`/follow-ups/:id/booking`) render the same detail, so the shape lives here to
 * stay in sync.
 */

export const DMS_BOOKING_DETAIL_SELECT = `
  id, external_id, external_source, status, job_state,
  due_date, promise_time, booked_date, mileage_in, key_location,
  jobsheet_number, jobsheet_status, notes,
  booked_service_type, estimated_hours, is_mot_booking,
  origin_source, follow_up_case_id,
  customer_waiting, loan_car_required, is_internal, booked_repairs,
  customer:customers(title, first_name, last_name, contact_name, email, mobile, phone, address_line1, address_line2, town, county, postcode),
  vehicle:vehicles(registration, make, model, color, fuel_type, year, vin, mileage)
`

/* eslint-disable @typescript-eslint/no-explicit-any */
export function mapDmsBookingDetailRow(row: any) {
  const cust = row.customer || null
  const veh = row.vehicle || null
  const repairs = Array.isArray(row.booked_repairs) ? row.booked_repairs : []

  return {
    bookingId: row.external_id,
    source: row.external_source === 'gemini_osi' ? 'dms' : 'other',
    status: row.status,
    jobState: row.job_state,
    dueDate: row.due_date,
    promiseTime: row.promise_time,
    bookedDate: row.booked_date,
    mileageIn: row.mileage_in,
    keyLocation: row.key_location,
    jobsheetNumber: row.jobsheet_number,
    jobsheetStatus: row.jobsheet_status,
    serviceType: row.booked_service_type,
    estimatedHours: row.estimated_hours,
    isMot: !!row.is_mot_booking,
    isWaiting: !!row.customer_waiting,
    isLoan: !!row.loan_car_required,
    isInternal: !!row.is_internal,
    isOutreach: row.origin_source === 'follow_up',
    followUpCaseId: row.follow_up_case_id,
    notes: row.notes,
    customer: cust ? {
      name: [cust.title, cust.first_name, cust.last_name].filter(Boolean).join(' ').trim() || null,
      contactName: cust.contact_name,
      email: cust.email,
      mobile: cust.mobile,
      phone: cust.phone,
      address: [cust.address_line1, cust.address_line2, cust.town, cust.county, cust.postcode].filter(Boolean),
    } : null,
    vehicle: veh ? {
      registration: veh.registration,
      make: veh.make,
      model: veh.model,
      year: veh.year,
      color: veh.color,
      fuelType: veh.fuel_type,
      vin: veh.vin,
      mileage: veh.mileage,
    } : null,
    bookedRepairs: repairs.map((r: any) => ({
      code: r.code ?? null,
      description: r.description ?? null,
      notes: r.notes ?? null,
      labour: Array.isArray(r.labourItems) ? r.labourItems.map((l: any) => ({
        description: l.description ?? null,
        units: l.units ?? null,
        price: l.price ?? null,
        fitter: l.fitter ?? null,
      })) : [],
    })),
  }
}
