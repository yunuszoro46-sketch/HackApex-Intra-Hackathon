# Design system (screen)

The design was generated with the `ui-ux-pro-max` skill (`scripts/search.py`, run on 12 Oct 2026), then adapted to this app's offline, no-dependency rules. The tokens live in `public/styles.css` (`:root`).

## Searches run

| Command | Used result |
|---|---|
| `search.py "operations dashboard energy management scheduling data dense professional accessible" --design-system -p "Who Stays On"` | **Style:** Data-Dense Dashboard. **Palette:** navy primary `#1E40AF`, amber accent, `#F8FAFC` background. **Fonts:** Fira Sans / Fira Code. **Checklist:** 4.5:1 contrast, visible focus, reduced motion, 375-1440 px |
| `-d chart "hourly resource consumption cumulative budget"` | Running total shown as a line, with a visible table as the accessible fallback |
| `-d chart "capacity utilization vs limit time series"` | Line or bar over time; distinguish series by line style as well as colour; data table fallback |
| `-d color "energy utility status monitoring"` | Results were for a fitness app and an IoT dashboard. **Not used**, beyond confirming that status colour is green |
| `-d ux "loading error empty state accessibility focus"` | Errors announced (`role="alert"`); chips are real buttons with `aria-pressed` |
| `-d ux "data table dense responsive"` | Wide table scrolls inside its own container on phones |

**Rejected from the skill output:**

- **The "Enterprise Gateway" landing pattern** (hero, client logos, contact sales). This is a working tool, not a landing page.
- **Fira fonts.** They would load from Google Fonts, and the app must run offline.

## Tokens

| Role | Light | Dark | Used for |
|---|---|---|---|
| Primary | `#1E40AF` | `#7AA2FF` | Main button, selected filter, load bars, focus ring |
| Diesel | `#B45309` | `#FBBF24` | Everything about fuel: diesel metric, diesel row, running-total line. Darkened from the skill's `#D97706` so text reaches 4.5:1 on white |
| Powered | `#166534` on `#DCFCE7` | `#86EFAC` on `#133824` | ✓ cells, OK chip |
| Dark (unpowered) | `#B91C1C` on `#FEE2E2` | `#FCA5A5` on `#451A1A` | ✗ cells, errors, over-limit values, limit lines |
| Grid hour | `#5B6B82` on `#E9EEF6` | `#8D9BB5` on `#1C263D` | Grid columns and chart bands |
| Warning | `#92400E` on `#FEF3C7` | `#FCD34D` on `#3A2A08` | Infeasible chip, best-effort banner, stale-result note |
| Background / card / line | `#F4F6FB` / `#FFFFFF` / `#D6DEEB` | `#0D1424` / `#151E33` / `#2A3654` | Surfaces |

- **Type:** the system UI font, with tabular numbers everywhere; a system monospace for the JSON box and the reason letters.
  - **Scale:** title 1.6 rem; panel heading 1.05 rem; metric value 1.45 rem bold; label 0.78 rem uppercase with letter-spacing.
- **Shape:** 8 px card radius, 1 px borders, no shadows, 14 px gap.
- **States:**
  - hover changes the border to primary;
  - keyboard focus is a 3 px primary outline;
  - disabled is 50 % opacity;
  - the loading chip pulses, except under reduced motion.

## Data display rules

- **The roster board is the centrepiece.**
  - Every cell carries a symbol as well as a colour: ✓, ✗ or "grid".
  - Each ✗ also carries a reason letter (D, C, B, N, Z, L) taken from the first words of the solver's own reason text.
  - Mandatory shops get ★ plus screen-reader text.
  - Outage columns are labelled "outage" and underlined in diesel colour.
- **The load chart is bars**, because each hour is a separate amount. Capacity is a dashed line, and each bar has its value printed on it.
- **The diesel chart is a step line**, because the running total grows only in outage hours. The budget is a dashed line, and each hour's total is printed.
- **Exact numbers stay in the board's footer rows.** The charts never replace them.
- **Load and diesel are separate charts.** Fuel follows the fuel table on the combined load, so spare kW is not shown as spare diesel.
- **No metric is invented.**
  - Peak load, remaining diesel and dark shop-hours are sums or maxima of fields in the API response.
  - Outage hours are counted from the input's `grid_available`.

## Accessibility and responsiveness

- **Announcements:** the status chip is `role="status"`; errors and conflicts use `role="alert"`.
- **Keyboard:** every ✗ is a real button, so Tab and Enter work, and each has an `aria-label` naming the shop, hour and reason type.
- **Phone widths:**
  - the board scrolls sideways inside its own container, with a sticky shop column;
  - the page itself never scrolls sideways (checked at 390 px);
  - metric cards wrap.
- **Dark mode** follows the operating-system setting.
- **Print:** one A4 landscape page with status, metrics and the board including reason letters and the load and diesel rows. Charts, controls and the long reason list are left out.

## Anti-patterns avoided

- No hero banner, gradients, glass effects, emoji icons or decorative charts.
- A result is never shown as OK before the server answers.
  - While a request runs, or after the input is edited, the old result is dimmed and labelled as belonging to the previous input.
