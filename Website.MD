# VHC Platform - Promotional Website Brief

> **Purpose:** This document is a self-contained brief for building a promotional/marketing website for the VHC (Vehicle Health Check) platform. It contains everything needed to design and build a compelling marketing site without access to the VHC codebase.

---

## 1. Product Identity

**Product Name:** VHC (Vehicle Health Check)

**Tagline:** "From Inspection to Approval in Minutes"

**One-liner:** A digital vehicle inspection platform that connects your workshop to your customers — with photos, pricing, and online approvals built in.

**Positioning:** VHC is a modern, multi-tenant SaaS platform purpose-built for automotive dealerships and independent service centres. It replaces paper-based vehicle health checks with a digital workflow that flows from technician inspection through advisor pricing to customer approval — all in one platform.

**Domain/Category:** Automotive SaaS / Workshop Management / Digital Vehicle Inspection

---

## 2. Target Audience

### Primary Personas

| Persona | Role | Pain Points | What They Care About |
|---------|------|-------------|---------------------|
| **Service Director** | Runs service dept across 1-5+ locations | No visibility into daily throughput, inconsistent inspection quality, low repair uptake | Live dashboards, multi-site management, conversion metrics |
| **Service Advisor** | Creates quotes, contacts customers | Slow quote turnaround, phone tag with customers, manual paperwork | Fast pricing tools, digital customer approval, real-time notifications |
| **Workshop Manager** | Oversees technicians | Can't see who's doing what, no accountability for inspection quality | Technician queue, live progress tracking, photo evidence |
| **Dealership Owner / Group** | Multi-location operation | Inconsistent processes across sites, no consolidated reporting | Multi-tenant architecture, group-level analytics, standardisation |
| **Independent Garage Owner** | Single-site operator | Paper-based, losing customers to dealerships with digital tools | Affordable, easy to adopt, professional customer-facing reports |

### Secondary Personas
- **Technicians** — Need an app that works in the workshop (offline, gloves, bright light)
- **Finance / Accounts** — Need revenue visibility and parts margin tracking

### Industry Context
- Franchise dealerships (manufacturer-affiliated)
- Independent garages and service centres
- Multi-site dealership groups
- MOT testing centres (UK market)

---

## 3. Key Value Propositions

Use these as the core selling points throughout the site:

### 1. "Prove It with Photos"
Every inspection finding is backed by photographic evidence. Customers see exactly what the technician found — no guesswork, no suspicion. Photo evidence demonstrably increases repair authorization rates.

### 2. "Customer Approvals, Not Phone Tag"
Customers receive a branded digital report via SMS/email. They view findings, see photos, and approve or decline repairs online — on their phone, in their own time. No more chasing customers by phone.

### 3. "Built for the Workshop, Not the Office"
The technician app is a Progressive Web App with offline support, large touch targets for gloved hands, and high-contrast UI for bright workshop lighting. It works without WiFi and syncs when back online.

### 4. "One Dashboard, Every Location"
Multi-site dealership groups manage all locations from a single platform. Standardised templates, consolidated reporting, and role-based access keep everyone aligned.

### 5. "AI-Powered Descriptions That Sell"
AI generates professional, customer-friendly descriptions for every finding. Two versions: technical (for advisors) and plain-English (for customers). Consistent, clear language increases customer confidence and approval rates.

### 6. "Real-Time Visibility"
Live dashboard shows exactly where every job is — which technician is inspecting, which advisor is pricing, which customer is viewing their report. No more asking "where's that job at?"

---

## 4. Feature Descriptions (For Website Sections)

### 4.1 Digital Vehicle Inspection

**Headline:** "Comprehensive digital inspections in minutes"

**Description:** Technicians complete inspections on their phone or tablet using customisable check templates. Each item is marked Red (urgent), Amber (advisory), or Green (passed) with photos and notes. Templates are fully configurable per organisation — add sections, reorder items, set required fields, and choose from multiple input types (RAG status, measurements, tyre depths, yes/no, dropdowns, and more).

**Key Points:**
- Customisable inspection templates with drag-and-drop builder
- RAG (Red/Amber/Green) traffic light system for instant visual priority
- Photo capture with annotation for every finding
- Specialised inputs: tyre depth (4-position per wheel), brake measurements, fluid levels
- Section-by-section navigation with progress tracking
- Works offline — syncs automatically when connection returns

---

### 4.2 Technician Mobile App (PWA)

**Headline:** "Built for technicians, not against them"

**Description:** A Progressive Web App that works like a native app — no App Store download required. Designed for workshop conditions with large touch targets (56px minimum), high-contrast colours, and one-handed navigation. Runs offline with automatic background sync.

**Key Points:**
- No app store — works in the browser, installs to home screen
- Offline-first: IndexedDB storage + service worker + background sync
- Glove-friendly 56px touch targets
- High-contrast UI for bright workshop lighting
- Camera integration for instant photo capture
- Bottom tab bar for one-handed navigation
- Today's job list with live status updates

---

### 4.3 Service Advisor Dashboard

**Headline:** "See everything. Action anything. Miss nothing."

**Description:** A real-time command centre for service advisors and managers. Summary cards show today's numbers at a glance. Four live queues track every job: technician progress, advisor pricing, customer decisions, and completed work. A Kanban board view lets advisors drag jobs between stages.

**Key Points:**
- **Summary cards** — Status counts, overdue items, conversion rates, revenue
- **Technician queue** — Live progress (assigned, in progress, paused, completed)
- **Advisor queue** — Items awaiting review, pricing, parts sourcing
- **Customer queue** — Sent reports, viewed, pending decisions
- **Kanban board** — Drag-and-drop cards between workflow stages
- **Real-time updates** — WebSocket-powered live notifications
- **Awaiting arrival** — DMS-imported appointments pending arrival

---

### 4.4 Pricing & Quoting

**Headline:** "Professional quotes in clicks, not hours"

**Description:** Add labour and parts to any finding with built-in pricing tools. Group related repairs (e.g., "Front Brake Overhaul" bundles pads, discs, and labour). Offer customers repair options (standard vs premium parts). VAT is calculated automatically with MOT labour VAT-exempt handling.

**Key Points:**
- Labour codes with configurable hourly rates (Standard, Diagnostic, MOT)
- Parts pricing with cost/sell prices and margin calculator
- Repair groups — bundle related items into a single customer-facing line
- Repair options — offer alternatives (e.g., OEM vs aftermarket parts)
- VAT handling with ex-VAT entry and inc-VAT display
- Price override capability with full audit trail
- Bulk actions — authorise, defer, or decline multiple items at once

---

### 4.5 Customer Portal

**Headline:** "Your customers approve repairs from their phone"

**Description:** Customers receive a secure link via SMS or email. No login required — they tap the link and see a branded, mobile-optimised health check report with RAG-coded findings, photo evidence, and clear pricing. They approve or decline each item, sign digitally, and submit. The advisor is notified instantly.

**Key Points:**
- **Token-based access** — no login, no password, just tap the link
- **Mobile-first design** — 90%+ of customers open on their phone
- **Branded experience** — dealership logo and colours
- **Photo gallery** — swipeable images per finding with captions
- **Clear pricing** — labour, parts, and total breakdown per item
- **Approve / Decline** — per item or per group
- **Digital signature** — canvas signature capture on screen
- **Activity tracking** — advisors see when customer opens, views, and acts
- **Configurable link expiry** — 24 hours to 14 days
- **PDF download** — customers can save the report

---

### 4.6 Notifications & Communication

**Headline:** "Never miss a customer decision again"

**Description:** Automated SMS and email notifications keep customers and staff informed at every stage. Customers get the report link and follow-up reminders. Advisors get instant alerts when customers view or respond. Managers get daily business summaries by SMS.

**Key Points:**
- **Customer notifications:** Report ready, 24h reminder, 48h reminder, link expiring
- **Staff notifications:** Customer viewed, customer authorised, customer declined, link expired
- **Channels:** SMS (Twilio), Email (Resend), in-app notifications, WebSocket push
- **Daily SMS overview:** Configurable daily summary sent to managers — inspections completed, authorisations, revenue
- **Customisable templates:** Edit SMS and email wording per organisation

---

### 4.7 AI-Powered Descriptions

**Headline:** "Professional language that builds trust"

**Description:** Powered by Anthropic Claude AI, VHC generates professional descriptions for every inspection finding — automatically. Each item gets two versions: a technical description for advisors and a customer-friendly plain-English explanation. Choose between a premium (formal) or friendly (warm) tone to match your brand.

**Key Points:**
- Dual descriptions: technical (advisor) + customer-friendly (plain English)
- Bulk generation — seed entire templates with AI in one click
- Tone selection — Premium (formal) or Friendly (warm)
- Regeneration — update descriptions without losing manual edits
- Per-organisation usage limits and cost tracking
- Technician-submitted custom reasons with admin approval workflow

---

### 4.8 Reporting & Analytics

**Headline:** "Data-driven decisions, not gut feelings"

**Description:** Track every metric that matters. Health check volume, conversion rates, revenue, technician workload, advisor performance, and customer response times. Filter by date range, site, technician, or advisor. Export to CSV for deeper analysis.

**Key Points:**
- Health check volume by date range, status, technician, advisor, site
- Conversion metrics — identified vs authorised vs declined
- Revenue tracking — total authorised value, parts/labour breakdown
- Technician workload — jobs per tech, average completion time
- Advisor performance — checks processed, authorization rate
- Customer response time — time from send to decision
- Date range, site, and user filtering
- CSV export

---

### 4.9 DMS Integration

**Headline:** "Plug into your existing systems"

**Description:** VHC integrates with Dealer Management Systems to import customer appointments, vehicle data, and booked services automatically. No manual data entry — jobs appear in the "Awaiting Arrival" queue ready for the day. Mark arrived to push to technician queue, or mark no-show to clear.

**Key Points:**
- Gemini OSI integration (with architecture for additional DMS providers)
- Automatic import of customer, vehicle, and appointment data
- "Awaiting Arrival" queue on advisor dashboard
- One-click "Mark Arrived" to move to technician queue
- No duplicate data entry
- Vehicle history preserved across visits

---

### 4.10 Multi-Tenant Architecture

**Headline:** "One platform for your entire group"

**Description:** VHC is built from the ground up for multi-site operations. Each organisation gets complete data isolation with row-level security. Manage users, templates, pricing, and settings across all locations from a single admin panel. Standardise processes while allowing site-specific customisation.

**Key Points:**
- Complete data isolation between organisations (row-level security)
- Organisation-level and site-level settings
- Centralised user management with role-based access
- 5-level role hierarchy: Technician, Service Advisor, Site Admin, Org Admin, Super Admin
- Shared or site-specific inspection templates
- Consolidated reporting across all sites
- Single sign-on across locations

---

### 4.11 Customisation & Configuration

**Headline:** "Your workflow, your way"

**Description:** Every organisation can tailor VHC to their processes. Build custom inspection templates, define your own labour codes and rates, configure declined/deleted reason lists, set notification preferences, customise SMS/email templates, and control workflow steps like check-in and MRI scans.

**Key Points:**
- Drag-and-drop template builder with 10+ input types
- Configurable labour codes and hourly rates
- Custom declined/deleted reason lists
- Editable SMS and email templates
- Optional workflow steps (check-in, MRI scan)
- Branding (logo, colours) on customer portal
- Link expiry settings
- VAT and pricing display preferences

---

## 5. Suggested Website Page Structure

### Page 1: Homepage / Hero

**Hero Section:**
- Headline: "Vehicle Health Checks, Digitised."
- Subheadline: "From technician inspection to customer approval — one platform, zero paperwork."
- Primary CTA: "Book a Demo" (form or calendar link)
- Secondary CTA: "See How It Works" (scroll to workflow section)
- Hero visual: Dashboard screenshot or animated workflow showing inspection > pricing > customer approval flow
- Trust indicators: "Trusted by X dealerships" / "X,000+ inspections completed"

**Value Proposition Strip (3-4 cards):**
1. "Photo Evidence" — Every finding backed by images
2. "Online Approvals" — Customers decide from their phone
3. "Real-Time Tracking" — Live dashboard for every job
4. "Multi-Site Ready" — One platform for all your locations

**Feature Overview Section:**
- 3-column grid highlighting top features with icons
- Link to dedicated features page

**How It Works Section:**
- 4-step visual workflow (see Section 6 below)

**Social Proof Section:**
- Testimonials / case studies (placeholder for now)
- Key metrics: "X% increase in approval rates" / "X minutes saved per inspection"

**Pricing Section (or link to pricing page):**
- Tier overview cards

**Final CTA:**
- "Ready to modernise your workshop?" + Book a Demo button

---

### Page 2: Features

**Layout:** Feature sections alternating left/right with screenshots

Sections (each with headline, 2-3 paragraph description, bullet points, and screenshot/illustration):
1. Digital Vehicle Inspection
2. Technician Mobile App
3. Service Advisor Dashboard
4. Pricing & Quoting
5. Customer Portal
6. Notifications & Communication
7. AI-Powered Descriptions
8. Reporting & Analytics
9. DMS Integration
10. Multi-Tenant Management
11. Customisation & Configuration

---

### Page 3: How It Works

**Visual step-by-step walkthrough:**

**Step 1: Create or Import**
- Jobs arrive via DMS integration or manual creation
- Vehicle and customer data pre-populated
- Icon: Calendar / Import

**Step 2: Technician Inspects**
- Technician opens job on mobile app
- Completes RAG inspection with photos and notes
- Works offline if needed — syncs when back online
- Icon: Mobile phone / Wrench

**Step 3: Advisor Prices**
- Advisor reviews findings on dashboard
- Adds labour, parts, and pricing
- Groups related repairs, adds options
- Previews customer-facing report
- Icon: Calculator / Dashboard

**Step 4: Customer Decides**
- Customer receives branded report via SMS/email
- Views findings with photos on their phone
- Approves or declines each item
- Signs digitally and submits
- Icon: Phone / Checkmark

**Step 5: Work Authorised**
- Advisor instantly notified of customer decisions
- Authorised work scheduled
- Deferred items tracked for follow-up
- Full audit trail maintained
- Icon: Clipboard / Green tick

---

### Page 4: Pricing

**Suggested Tier Structure:**

| | Starter | Professional | Enterprise |
|--|---------|-------------|------------|
| **For** | Independent garages | Single dealerships | Multi-site groups |
| **Sites** | 1 | 1-3 | Unlimited |
| **Users** | Up to 5 | Up to 20 | Unlimited |
| **Inspections** | 100/month | Unlimited | Unlimited |
| **Customer Portal** | Yes | Yes | Yes |
| **SMS Notifications** | Pay-per-SMS | Included allocation | Included allocation |
| **AI Descriptions** | Limited | Full | Full |
| **DMS Integration** | - | Add-on | Included |
| **Reporting** | Basic | Full | Full + Custom |
| **API Access** | - | - | Yes |
| **Support** | Email | Email + Phone | Dedicated Account Manager |

> **Note to builder:** Pricing tiers are suggestions. Final pricing should be confirmed with the VHC team. Use "Book a Demo" or "Contact Sales" for Enterprise tier rather than showing a price.

**Below pricing table:**
- FAQ section (common objections)
- "All plans include" list: SSL, updates, backups, onboarding
- CTA: "Not sure which plan? Talk to us"

---

### Page 5: Who It's For

**Section per role/persona:**

**For Service Directors & Managers**
- Real-time visibility across all jobs and staff
- Conversion metrics and revenue tracking
- Daily SMS business summaries
- Multi-site consolidated reporting

**For Service Advisors**
- Fast pricing tools with labour codes and parts lookup
- One-click customer communication via SMS/email
- Instant notifications when customers respond
- Professional branded reports that sell

**For Technicians**
- Mobile app built for workshop conditions
- Offline-capable — works without WiFi
- Photo capture and RAG system — simple and fast
- No typing essays — select from pre-built reasons

**For Dealership Groups**
- Multi-tenant architecture with complete data isolation
- Standardised templates across all sites
- Role-based access control (5-level hierarchy)
- Consolidated group-level analytics

**For Independent Garages**
- Affordable entry point to digital inspections
- Professional customer-facing reports (compete with franchises)
- Easy setup — no IT department needed
- AI-generated descriptions save time on setup

---

### Page 6: Contact / Book a Demo

- Demo booking form or embedded calendar (Calendly/Cal.com)
- Contact details
- "What happens next" steps: 1. Book demo, 2. We show you the platform, 3. Trial setup, 4. Go live

---

## 6. Tone & Messaging Guidelines

### Voice
- **Professional but approachable** — not corporate-stiff, not startup-casual
- **Confident** — we know the automotive service industry
- **Practical** — focus on real problems solved, not buzzwords
- **UK English** — "authorise" not "authorize", "colour" not "color", "centre" not "center"

### Avoid
- Jargon without explanation (define "RAG", "VHC", "DMS" on first use)
- Hyperbole ("revolutionary", "game-changing", "disrupting")
- Generic SaaS language ("leverage", "synergise", "empower")
- Overpromising on AI capabilities

### Do
- Use concrete numbers and specifics where possible
- Reference real workshop scenarios (gloves, bright lighting, offline)
- Address pain points directly ("tired of phone tag with customers?")
- Use active voice ("Technicians complete inspections" not "Inspections are completed by technicians")

### CTA Language
- Primary: "Book a Demo" / "Get a Demo"
- Secondary: "See How It Works" / "Explore Features"
- Avoid: "Sign Up Free" / "Start Trial" (this is a demo-led sales motion)

---

## 7. RAG Colour System (For Visual Design)

The Red/Amber/Green (RAG) traffic light system is central to VHC's identity and should feature prominently in the website design.

### Colours

| Status | Meaning | Hex | Tailwind | Usage |
|--------|---------|-----|----------|-------|
| **Red** | Urgent / Safety-critical | `#dc2626` | `bg-red-600` | Items requiring immediate attention |
| **Amber** | Advisory / Monitor | `#ca8a04` | `bg-yellow-600` | Items to watch or address soon |
| **Green** | Passed / Good condition | `#16a34a` | `bg-green-600` | Items in satisfactory condition |

### Visual Application
- Use RAG colours in feature screenshots and illustrations
- Show example inspection results with colour-coded items
- Hero section could include an animated RAG status being set
- Customer portal mockup should show colour-coded findings list
- Dashboard screenshots should show RAG summary cards

### Brand Colours (Product UI)
- **Primary:** Indigo (`#1e40af` / `indigo-700`) — buttons, links, active states
- **Background:** White with subtle gray borders
- **Cards:** White with `rounded-xl` corners and light shadows
- **Text:** Gray-900 for headings, Gray-600 for body

### Website Brand Suggestion
The promotional website can use its own brand colours but should incorporate:
- RAG colours prominently in feature visuals and illustrations
- Indigo as an accent to maintain connection with the product
- Clean, modern aesthetic with generous whitespace
- Professional automotive feel — not playful/startup

---

## 8. Workflow Diagram (For "How It Works")

```
 [1]              [2]              [3]              [4]              [5]
 DMS Import       Technician       Advisor          Customer         Work
 or Manual        Inspects         Prices           Decides          Authorised
 ─────────── ──> ─────────── ──> ─────────── ──> ─────────── ──> ───────────
 Job Created      RAG + Photos     Labour/Parts     Views Report     Approved items
 Vehicle data     Offline-capable  Repair groups    Photo evidence   scheduled
 pre-populated    Notes & reasons  Preview report   Approve/Decline  Deferred items
                                   Send to customer Digital signature tracked
```

### 28-Status Workflow (Technical Reference)
The platform tracks health checks through 28 granular states. This level of detail is a differentiator — every step is tracked and visible:

**Inspection Phase:** `inspection_pending` > `inspection_in_progress` > `inspection_complete`

**Pricing Phase:** `pricing_pending` > `pricing_in_progress` > `pricing_complete` > `advisor_review`

**Customer Phase:** `customer_pending` > `customer_viewed` > `customer_approved` / `customer_partial` / `customer_declined`

**Work Phase:** `work_authorized` > `work_in_progress` > `work_complete`

**Final:** `closed`, `archived`, `cancelled`

> For the website, simplify this to the 5-step visual workflow above. Mention "28 granular status states" as a feature point for detail-oriented buyers.

---

## 9. Competitive Differentiators

Use these when positioning against competitors:

| Differentiator | VHC Advantage |
|---------------|---------------|
| **Offline mobile app** | PWA with IndexedDB + service worker. Competitors typically require constant connectivity. |
| **AI-generated descriptions** | Claude AI creates professional dual-tone descriptions (technical + customer). No competitor offers this. |
| **True multi-tenancy** | Row-level security, org/site hierarchy, role-based access. Not just "multiple logins" — real data isolation. |
| **28-state workflow tracking** | Granular visibility into every stage. Most competitors track 5-6 states. |
| **Customer portal (no login)** | Token-based access — customers tap a link and see their report. No account creation, no friction. |
| **Photo evidence per finding** | Every RAG item can have annotated photos. Builds trust, increases approvals. |
| **DMS integration** | Direct Gemini OSI integration with architecture for additional providers. |
| **Repair groups & options** | Bundle related items AND offer alternatives. Sophisticated quoting, simple customer view. |
| **Real-time WebSocket updates** | Live dashboard — not polling, not refresh-to-update. Instant notifications. |
| **Daily SMS business summary** | Managers get KPIs by text every evening. No logging in required. |

---

## 10. Technical Highlights (For "Under the Hood" or Trust Section)

For technical buyers (IT managers, CTOs at dealership groups):

- **Architecture:** Modern TypeScript monorepo — React frontend, Hono API, PostgreSQL database
- **Hosting:** Railway (containerised deployment with auto-scaling)
- **Database:** PostgreSQL via Supabase with row-level security
- **Authentication:** JWT-based with Supabase Auth
- **Real-time:** WebSocket (Socket.io) for live updates
- **Queue system:** BullMQ + Redis for reliable background jobs (SMS, email, scheduled tasks)
- **Mobile:** Progressive Web App — no App Store dependency, instant updates
- **AI:** Anthropic Claude API with per-organisation usage limits and cost tracking
- **CI/CD:** GitHub Actions with automated migration checks and deployment
- **Security:** Row-level security, role-based access, audit trails, encrypted API keys, configurable token expiry

---

## 11. Content for FAQ Section

**Q: Do technicians need to download an app?**
A: No. VHC's technician app is a Progressive Web App (PWA) that works in any modern browser. Technicians can add it to their home screen for a native app experience — no App Store or Google Play required. Updates happen automatically.

**Q: What happens if the workshop has poor WiFi?**
A: VHC's mobile app works offline. Inspections, photos, and notes are saved locally on the device and sync automatically when connectivity returns. Technicians can complete full inspections without any internet connection.

**Q: How do customers see their health check?**
A: Customers receive an SMS or email with a secure link. They tap the link — no login or account creation needed — and see a branded, mobile-optimised report with RAG-coded findings, photos, and pricing. They can approve or decline items and sign digitally.

**Q: Can we customise the inspection template?**
A: Yes. Organisation admins build custom templates with a drag-and-drop editor. Add sections, reorder items, choose input types (RAG, measurements, yes/no, dropdowns, etc.), and set required fields. Templates can be shared across all sites or customised per location.

**Q: Does VHC integrate with our DMS?**
A: VHC integrates with Gemini OSI for automatic appointment and vehicle data import. The architecture supports additional DMS providers — contact us to discuss your specific system.

**Q: How is our data protected?**
A: VHC uses PostgreSQL row-level security to ensure complete data isolation between organisations. All API access is authenticated with JWT tokens. A 5-level role hierarchy ensures staff only see what they need. Full audit trails track every status change.

**Q: Can we use VHC across multiple locations?**
A: Yes. VHC is built for multi-site operations. Each site has its own staff, templates, and settings, while organisation admins get consolidated reporting and centralised management across all locations.

**Q: What does the AI do?**
A: VHC uses AI (Anthropic Claude) to generate professional descriptions for inspection findings. Each item gets a technical description (for advisors) and a customer-friendly plain-English explanation. This ensures consistent, professional messaging that helps customers understand findings and increases approval rates.

---

## 12. SEO Keywords & Phrases

Target these for organic search:

**Primary:**
- Vehicle health check software
- Digital vehicle inspection platform
- Automotive inspection software UK
- Workshop management software
- Digital health check system

**Secondary:**
- Customer approval portal automotive
- Technician inspection app
- Service advisor dashboard
- Multi-site dealership software
- DMS integration vehicle inspection
- RAG inspection system
- Online vehicle health check

**Long-tail:**
- "How to digitise vehicle health checks"
- "Vehicle inspection software with customer portal"
- "Offline inspection app for workshops"
- "AI-powered vehicle inspection descriptions"
- "Multi-site dealership inspection management"

---

## 13. Assets & Visuals Needed

The website builder should create or source:

1. **Product screenshots** — Dashboard, mobile app, customer portal, pricing view, Kanban board
2. **Workflow illustration** — 5-step visual flow (import > inspect > price > approve > authorise)
3. **RAG colour examples** — Visual showing red/amber/green status in action
4. **Device mockups** — Phone (technician app + customer portal), tablet, desktop (advisor dashboard)
5. **Icons** — For each feature section (inspection, pricing, notifications, AI, reporting, DMS, multi-tenant)
6. **Hero visual** — Either animated product demo or composite screenshot showing the full workflow
7. **Persona illustrations** — Service director, advisor, technician, customer (optional)
8. **Trust badges** — Security, uptime, data isolation indicators

---

## 14. Technical Notes for Website Builder

- **UK market focus** — Use British English spelling throughout
- **Responsive design** — Mobile-first (many prospects will find this on their phone)
- **Performance** — Fast loading — these are busy people, not browsing for fun
- **Accessibility** — WCAG 2.1 AA compliance
- **Analytics** — Set up conversion tracking on "Book a Demo" CTA
- **Forms** — Keep demo booking form short (name, email, phone, company, number of sites)
- **No pricing page initially** — Consider "Contact for Pricing" with tier overview, or use suggested tiers above as starting point
- **Cookie consent** — Minimal, privacy-respecting (aligns with product values)

---

## 15. Suggested Tech Stack for the Website

This is a marketing/promotional site, not the product itself. Suggested approaches:

- **Static site generator** (Astro, Next.js static, or similar) for speed
- **Tailwind CSS** for styling (consistent with product aesthetic)
- **Headless CMS** for testimonials/case studies if content will update frequently
- **Vercel or Netlify** for hosting (fast, simple)
- **Cal.com or Calendly** embed for demo booking

---

*This brief is self-contained. A developer or AI agent should be able to build a complete promotional website from this document alone, without needing access to the VHC codebase or additional context.*
