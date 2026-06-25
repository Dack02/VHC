# Handoff: Ollo Inspect — Dashboard Redesign (Direction B, "Operational Grid")

## Overview
A redesign of the Ollo Inspect dashboard for **Central Garage** — a vehicle health-check (VHC) management app used by service advisors and garage managers. The goal of the redesign was to keep **all existing data** but reduce visual busyness through **stronger hierarchy, more whitespace, grouped modules, and restrained colour**. The original screen rendered every metric as an equally-weighted coloured card; this version groups metrics into labelled modules ("Today", "This month", pipeline) so the eye lands on the big numbers first and colour is reserved for status meaning.

The primary job of this screen: **track daily and monthly KPIs at a glance**, and surface anything that needs action right now.

## About the Design Files
The file in this bundle is a **design reference created in HTML** — a prototype showing the intended look, layout, and behaviour. It is **not production code to copy directly**. The task is to **recreate this design in the target codebase's existing environment** (e.g. React/Vue/Angular + your component library and styling system) using its established patterns. If no front-end environment exists yet, choose the most appropriate framework for the project and implement the design there.

The prototype uses a small runtime wrapper (`*.dc.html`) and the [Lucide](https://lucide.dev) icon set via CDN purely for prototyping convenience — **do not** carry those over; use your codebase's icon system and component primitives.

## Fidelity
**High-fidelity (hifi).** Colours, typography, spacing, radii, and copy are final and exact. Recreate the UI pixel-faithfully using your codebase's existing components, then wire the metrics to real data. Numbers shown are sample/representative values from the source screen — bind them to live data sources.

---

## Layout (overall)
- **App shell**: fixed-width left sidebar + fluid main column.
  - **Sidebar**: `234px` wide, `#fff`, `1px solid #ededeb` right border, sticky full-height. Sections top-to-bottom: brand → nav list (`flex:1`) → user/sign-out footer.
  - **Main**: `flex:1`. Sticky top bar (`60px`) + scrolling content. Content padded `34px 40px 44px`, capped at `max-width:1320px`.
- **Page background**: `#f4f4f2` (warm off-white). **Cards/surfaces**: `#fff`. Module wells: `#fafaf8`.
- **Content stack** (top → bottom), each block separated by `24px`:
  1. Page header (title + date-range segmented control + actions)
  2. Action Center banner (full width)
  3. Two-column module row: **Today** (left) + **This month** (right), `grid-template-columns:1fr 1fr; gap:24px`
  4. **Health check pipeline** (full width)
  5. Bottom row: **Technician workload** + **With customer**, `grid-template-columns:1.45fr 1fr; gap:24px`

---

## Components / Views

### 1. Sidebar — brand
- Mark: `32×32`, `border-radius:9px`, bg `#16181d`, white `CG`, weight 800, 13px.
- Title `Central Garage` (14px/700, `#16181d`, nowrap) over subtitle `Ollo Inspect` (11px/500, `#a4a8b0`).

### 2. Sidebar — nav
- Items (15): Tiles, **Dashboard (active)**, Health Checks, Workshop, Notes `2`, Upcoming, Customers, Follow-Ups `65`, Messages, Parts, Reports, Templates, Packages, Users, Settings.
- Row: `display:flex; gap:11px; padding:9px 11px; border-radius:9px; font-size:13.5px`.
- Default: color `#5f636c`, weight 500, transparent bg. Hover bg `#f3f3f1`.
- **Active** (Dashboard): bg `#eceefb`, color `#3a45c9`, weight 600.
- Icon `18px`, stroke-width `1.75`, inherits row colour (`currentColor`).
- Badge pill: 11px/600, color `#7b7f88`, bg `#f0f0ee`, `border-radius:20px; padding:1px 8px; min-width:21px; text-align:center`. (Badges intentionally **neutral**, not red, to reduce colour noise.)

### 3. Sidebar — footer
- Avatar `34×34` circle, bg `#eceefb`, text `#3a45c9`, `LD`, 700/13px. Name `Leo Dack` (13px/600), role `Org Admin` (11px, `#a4a8b0`). Separated from nav by `1px solid #f0f0ee` top border.
- Sign out row: 13px, `#7b7f88`, log-out icon, hover bg `#f3f3f1`.

### 4. Top bar
- `60px` tall, white, `1px solid #ededeb` bottom border, sticky (`z-index:5`), padding `0 40px`.
- Left: `Central Garage workspace` (13px/500, `#a4a8b0`).
- Right: `Org Admin` pill (12px/600, color `#3a45c9`, bg `#eceefb`, `border-radius:20px; padding:5px 12px`) + bell icon (`#7b7f88`).

### 5. Page header
- `Dashboard` — `font-size:30px; weight:800; letter-spacing:-.025em; color:#16181d`.
- `Live` indicator beside it: green dot `7px` `#2c9367` + label 12px/600 `#2c9367`.
- Sub-line: `22 June 2026 · today at a glance` (13.5px, `#7b7f88`).
- **Date-range segmented control**: container white, `1px solid #e6e6e3`, `border-radius:10px`, `padding:3px`, `gap:2px`. Active segment (`Today`): bg `#16181d`, white text, `border-radius:7px; padding:6px 15px`. Inactive (`7 Days`, `30 Days`): 13px/500, `#7b7f88`.
- **Action buttons** (right of control, `gap:10px`):
  - `Kanban` — secondary: white, `1px solid #e6e6e3`, `border-radius:10px; padding:8px 14px`, 13px/600 `#5f636c`, columns icon, hover bg `#f7f7f5`.
  - `Today View` — primary: bg `#16181d`, white text, calendar-check icon.
  - `Reports` — secondary (no icon).

### 6. Action Center banner
- Full-width white card, `border:1px solid #ededeb`, **`border-left:4px solid #cf4a45`** (red status accent), `border-radius:14px; padding:15px 22px`. Flex row, space-between.
- Left: red icon chip `34×34`, `border-radius:10px`, bg `#fbeceb`, color `#cf4a45`, bell-ring icon. Then:
  - Title: `Action Center · 1 awaiting arrival` (14px/700, `#16181d`).
  - Detail row (12.5px, `#7b7f88`): a **reg-plate chip** then `Ford Fiesta · Multifleet · Due 01:00 · 1 pre-booked`.
  - Plate chip: `IBM Plex Mono` 11.5px, bg `#fdf6dd`, `1px solid #efe2a8`, color `#796a1f`, `border-radius:5px; padding:2px 7px`.
- Right actions: **Arrived** (bg `#2c9367`, white, `border-radius:9px; padding:9px 17px; 13px/600`) + **No show** (white, `1px solid #e6e6e3`, `#5f636c`, hover bg `#f7f7f5`).

### 7. Module — "Today"
- Well: bg `#fafaf8`, `1px solid #ededeb`, `border-radius:18px; padding:20px`.
- Header: green dot `8px` `#2c9367` + `Today` (15px/700) on the left; `Live · resets at midnight` (11.5px, `#a4a8b0`) on the right.
- Grid: `repeat(3,1fr); gap:11px` → **9 tiles**.
- Tile: white, `1px solid #ededeb`, `border-radius:12px; padding:15px 16px`. Label 12px/600 `#7b7f88`; value 23px/800, `letter-spacing:-.02em`, `font-variant-numeric:tabular-nums`. Optional note/sub 10.5px `#a4a8b0`.
- The 6 KPI tiles (label · value · value-colour):
  - Health Checks · `0` · `#16181d`
  - Completed · `0` · `#2c9367`
  - Conversion · `0%` · `#3a45c9` · note `Nothing presented yet`
  - Avg Time to Open · `0m` · `#16181d`
  - Authorized · `£0.00` · `#2c9367`
  - Declined · `£0.00` · `#cf4a45`
- The 3 sales tiles have a leading status dot `7px` + sub-line:
  - Red Sold · `—` · dot `#cf4a45` · `0 / 0 red items`
  - Amber Sold · `—` · dot `#c98a2b` · `0 / 0 amber items`
  - MRI Sold · `—` · dot `#3f7fd1` · `0 / 0 MRI items`

### 8. Module — "This month"
- White card, `1px solid #ededeb`, `border-radius:18px; padding:22px 24px`.
- Header: indigo dot `8px` `#4b56e6` + `This month` (15px/700); right meta `June vs May 2026` (11.5px `#a4a8b0`).
- **Metric rows** (flex, space-between, `padding:12px 0`, `border-bottom:1px solid #f3f3f1`):
  - Left: label 13.5px/600 `#3a3f48` (+ optional sub 11px `#a4a8b0`).
  - Right: value 17px/800 tabular + delta chip (12px/600, icon + text, `min-width:66px`, right-aligned).
  - Delta chips here are all **declines → red `#cf4a45`** with `arrow-down-right`. (For increases, use green `#2c9367` + `arrow-up-right`.)
  - Rows: Red Sold `58.8%` ↓2.5% · Amber Sold `18%` ↓1.6% · MRI Sold `13.5%` ↓9.1% (sub `5 / 37 MRI items`) · Avg Identified `£217.17` ↓£26.20 · Avg Sold `£56.11` ↓£33.00 · HCs / Day `4.9` ↓0.5.
- **Advisor of the Month banner** (focal): bg `#16181d`, `border-radius:13px; padding:14px 16px`, flex row. Avatar `38×38` circle bg `#2c2f37` white `KC`. Eyebrow `ADVISOR OF THE MONTH` (10.5px/700, uppercase, `letter-spacing:.07em`, `#8a8f98`); name `Katie Clarke` (15px/700 white). Right: `£6,614.73` (13.5px/700 white) + `73% red sold` (11px `#9aa0a8`). Trophy icon `#d9a441`.

### 9. Health check pipeline (full width)
- White card, `1px solid #ededeb`, `border-radius:18px; padding:20px 28px`.
- Header: `Health check pipeline` (15px/700) + right meta `8 active · 179 actioned today` (12.5px `#a4a8b0`).
- Row of 5 equal stages separated by `chevron-right` icons (`#d0d3d8`). Each stage centred: number 30px/800 tabular `letter-spacing:-.025em`, then a `gap:7px` row of status-dot `8px` + label (12px/600 `#7b7f88`).
  - Technician Queue `5` (dot `#a4a8b0`) → Tech Done / Review `2` (dot `#c98a2b`) → Ready to Send `1` (dot `#3f7fd1`) → With Customer `0` (dot `#7a5ad9`) → Actioned `179` (number coloured `#2c9367`, dot `#2c9367`).

### 10. Technician workload
- White card, `1px solid #ededeb`, `border-radius:18px; padding:20px 24px`.
- Header: `Technician workload` (15px/700) + `View all` link (13px/600 `#3a45c9`).
- Rows (`padding:12px 0; border-bottom:1px solid #f5f5f3`): avatar `34×34` circle bg `#f0f0ee` color `#5f636c` initials 12.5px/700; then a column with name (13.5px/600) + `N in queue` meta (12px `#a4a8b0`) on a space-between row, and a **progress bar** below.
- Progress bar: track `height:6px` bg `#f0f0ee` `border-radius:20px`; fill bg `#4b56e6`, width = load %.
  - Tom Wright 5 in queue (100%) · Katie Clarke 3 (60%) · Priya Shah 2 (40%) · James Bell 1 (20%).
  - *(Workload values are representative — bind to real queue counts / capacity.)*

### 11. With customer (empty state)
- White card, `border-radius:18px; padding:20px 24px`, flex column. Header `With customer` (15px/700).
- Centred empty state: circle `46×46` bg `#f3f3f1` color `#a4a8b0` with `users-round` icon; `No checks with customers` (14px/600 `#3a3f48`); helper `Authorised work and declines appear here as advisors share results.` (12.5px `#a4a8b0`, `max-width:240px; line-height:1.5`).

---

## Interactions & Behavior
- **Date-range segmented control** (`Today` / `7 Days` / `30 Days`): switches the period that *all* daily/flow metrics on the page reflect. Active = dark fill. Default `Today`.
- **Action Center → Arrived / No show**: updates the awaiting-arrival vehicle's status and removes it from the banner; banner count decrements. When 0 awaiting, hide the banner (or show a calm "Nothing needs action" state).
- **Top actions**: `Kanban` → Kanban/Workshop board view; `Today View` → today's job list; `Reports` → reports area.
- **View all** links → respective full lists (technician workload, action center).
- **Hover states**: nav rows, secondary buttons, and links all lighten to `#f7f7f5`/`#f3f3f1`.
- **Live indicator**: data refreshes in real time; `Today` metrics reset at midnight.
- **Empty / zero states**: metrics legitimately show `0`, `0%`, `0m`, `£0.00`, or `—` early in the day — keep these calm (no red just because a value is 0). Red is reserved for genuine declines/alerts.
- **Responsive**: below ~1100px, collapse the two-module row and the bottom row to single column; sidebar can collapse to icons. (Prototype is designed desktop-first at ~1320px content width.)

## State Management
- `dateRange`: `'today' | '7d' | '30d'` — drives which dataset feeds the daily metrics and the period label.
- `actionCenter`: list of awaiting-arrival vehicles `{ reg, make, model, account, dueTime, prebooked }`; mutated by Arrived/No-show.
- `todayMetrics`: health checks, completed, conversion %, avg time to open, authorized £, declined £, and red/amber/MRI sold counts.
- `monthlyMetrics`: per-KPI `{ label, value, deltaValue, direction }` for current vs previous month, plus advisor-of-the-month `{ name, redSoldPct, revenue }`.
- `pipeline`: counts per stage (queue, review, ready-to-send, with-customer, actioned).
- `technicianWorkload`: per-tech `{ name, queueCount, capacity }` → bar = queueCount / capacity.
- Data fetching: live/poll for today's flow + pipeline; monthly aggregates can be fetched per period change.

## Design Tokens
**Colours**
| Token | Hex | Use |
|---|---|---|
| Page bg | `#f4f4f2` | app background |
| Surface | `#ffffff` | cards |
| Well | `#fafaf8` | module background (Today) |
| Ink | `#16181d` | primary text / numbers / dark banner |
| Ink-2 | `#3a3f48` | secondary headings |
| Muted | `#5f636c` / `#7b7f88` | labels |
| Faint | `#a4a8b0` | meta / placeholders |
| Border | `#ededeb` | card borders |
| Border-soft | `#f3f3f1` / `#f5f5f3` | inner dividers |
| Control border | `#e6e6e3` | buttons / segmented control |
| Primary (indigo) | `#4b56e6` | bars; accent dot |
| Primary text/soft | `#3a45c9` / `#eceefb` | links, active nav, Org Admin pill |
| Status red | `#cf4a45` / soft `#fbeceb` | declines, alerts, Red |
| Status amber | `#c98a2b` | Amber / review |
| Status green | `#2c9367` | positive, Actioned, Live |
| Status blue | `#3f7fd1` | Ready to Send / MRI |
| Status purple | `#7a5ad9` | With Customer |
| Plate amber | bg `#fdf6dd`, border `#efe2a8`, text `#796a1f` | reg-plate chip |
| Trophy gold | `#d9a441` | advisor accent |

**Typography** — `Hanken Grotesk` (UI), `IBM Plex Mono` (reg plates only).
- H1 30/800 `-.025em` · section H2/H3 15/700 · KPI value (module) 23/800 `-.02em` · KPI value (hero/pipeline) 30/800 `-.025em` · monthly value 17/800 · body/label 12–13.5 · meta 11–12.5 · eyebrow 10.5–11/700 uppercase `.06–.08em`.
- All numeric values use `font-variant-numeric: tabular-nums`.

**Radius** — pills `20px`; cards/modules `18px`; inner tiles/banners `12–14px`; buttons/controls `9–10px`; icon chips `9–10px`.

**Spacing** — content padding `34px 40px 44px`; block gap `24px`; module padding `20–24px`; tile padding `15–16px`; grid gaps `11px` (tiles) / `24px` (columns).

**Shadows** — none on cards (flat + hairline borders define surfaces). Only the prototype's outer frame used a shadow; ignore for in-app.

## Assets
- **Icons**: prototyped with Lucide (`house`, `clipboard-check`, `columns-3`, `square-pen`, `calendar-clock`, `users`, `phone`, `message-circle`, `package`, `chart-column`, `file-text`, `boxes`, `user-round`, `settings`, `bell`, `bell-ring`, `log-out`, `arrow-down-right`/`arrow-up-right`, `chevron-right`, `trophy`, `users-round`, `calendar-check`, `layout-grid`). Use your codebase's icon library equivalents.
- **Fonts**: Hanken Grotesk + IBM Plex Mono (Google Fonts). Substitute your app's existing brand fonts if different; keep tabular numerals.
- **Logo**: placeholder `CG` monogram — swap for the real Central Garage logo.
- No raster images required.

## Files
- `Ollo Inspect Dashboard.dc.html` — the high-fidelity prototype of this dashboard (Direction B). Open in a browser to view; inspect the markup for exact inline styles. The chosen direction; build from this.
