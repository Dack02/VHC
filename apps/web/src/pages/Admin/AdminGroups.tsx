/**
 * AdminGroups — Super Admin reference for setting up a GROUP COMPANY
 * (several legal entities under common ownership, joined for group-level
 * reporting). See GMS/GROUPS_AND_SITES.md §7.
 *
 * Phase 1 (per-site customer/vehicle separation + site branding) is live. The
 * group MANAGEMENT UI is Phase 2; for now this page documents the model and the
 * super-admin setup runbook so the process is in-app.
 */

const Step = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
  <li className="flex gap-4">
    <span className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center text-sm font-semibold">
      {n}
    </span>
    <div className="pt-1">
      <p className="font-semibold text-gray-900">{title}</p>
      <p className="text-sm text-gray-600 mt-0.5">{children}</p>
    </div>
  </li>
)

export default function AdminGroups() {
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Groups</h1>
        <p className="text-gray-600 mt-1">
          How to set up a <strong>group company</strong> — several limited companies under
          common ownership, kept fully separate but reported on together.
        </p>
      </div>

      {/* Status banner */}
      <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg text-sm">
        <strong>Rolling out.</strong> Per-site separation and site branding are live. The
        group management screens (create group, link entities, group reporting) are in
        build — this page is the reference for the setup process in the meantime.
      </div>

      {/* Which model */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">First, pick the right model</h2>
        <p className="text-sm text-gray-600 mb-4">
          The deciding factor is the <strong>legal / accounting boundary</strong>, not branding.
          Branding, address, phone, technicians and the customer book can all differ per
          <em> site</em> inside one organisation.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="rounded-lg border border-gray-200 p-4">
            <p className="font-semibold text-gray-900 text-sm">One Ltd · several branches</p>
            <p className="text-sm text-gray-600 mt-1">
              One set of accounts (shared catalogue, pricing, Xero, VAT, billing).
              → <strong>One organisation, multiple sites.</strong> No group needed — site
              comparison comes for free. Just add sites to the org.
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 p-4">
            <p className="font-semibold text-gray-900 text-sm">Several separate Ltds</p>
            <p className="text-sm text-gray-600 mt-1">
              Separate Xero, VAT, invoice sequences and billing.
              → <strong>One organisation per entity, joined by a group.</strong> Each keeps
              its own data; the group adds a reporting rollup. Use the steps below.
            </p>
          </div>
        </div>
      </div>

      {/* Setup runbook */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Setting up a group (super-admin)</h2>
        <ol className="space-y-5">
          <Step n={1} title="Onboard each entity as its own organisation">
            Normal signup per limited company — each gets its own subscription, Xero/VAT and
            branding. This is a prerequisite, not a group step.
          </Step>
          <Step n={2} title="Create the group">
            Groups → Create group → give it a name (e.g. “Smith Motor Group”).
          </Step>
          <Step n={3} title="Add the member organisations">
            Add each entity to the group. An organisation can belong to at most one group;
            the picker only offers organisations that aren’t already in one.
          </Step>
          <Step n={4} title="Assign the group admin">
            Enter the owner’s email. They’re given an admin account in every member
            organisation automatically (one action = access to all entities), so they can
            switch between them with the organisation switcher.
          </Step>
          <Step n={5} title="Hand over">
            The owner logs in, switches between entities as needed, and opens Group Reporting
            to compare every site across all the companies, side by side.
          </Step>
        </ol>
      </div>

      {/* What stays separate */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">What the group does and doesn’t touch</h2>
        <div className="grid sm:grid-cols-2 gap-6 text-sm">
          <div>
            <p className="font-semibold text-gray-900 mb-2">Stays separate (per entity)</p>
            <ul className="list-disc list-inside text-gray-600 space-y-1">
              <li>Customers &amp; vehicles</li>
              <li>Parts catalogue &amp; pricing</li>
              <li>Xero, VAT &amp; invoice sequences</li>
              <li>Subscription &amp; billing</li>
            </ul>
          </div>
          <div>
            <p className="font-semibold text-gray-900 mb-2">Added by the group</p>
            <ul className="list-disc list-inside text-gray-600 space-y-1">
              <li>Cross-entity reporting rollup (compare sites)</li>
              <li>An owner who can move between entities</li>
            </ul>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-4">
          Note: each entity is billed separately — the group is reporting-only.
        </p>
      </div>
    </div>
  )
}
