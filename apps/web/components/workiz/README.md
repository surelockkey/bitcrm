# Workiz form kit (`@/components/workiz`)

Pixel-matched controls for rebuilding the New Job page (`/deals/new`) and the
job page's Details tab (`/deals/[id]`) 1:1 with Workiz. Every number comes from
the captures in
`workiz-data-parser/data/ui_reference/jobs_parity_2026-10-08/*.styles.json` and
from Workiz's own stylesheets (public CDN: `build.css`, `reactCss.css`,
`main.css`), not from eyeballing. Colours are the `wz*` tokens in
`lib/theme/tokens.ts` (Tailwind: `text-wz-label`, `border-wz-focus`, …).

```tsx
import {
  WzTextField, WzFieldGroup, WzTextarea, WzSelect, WzMultiSelect,
  WzDateField, WzTimeSelect, WzCalendar, WzSwitch, WzCheckbox,
  WzButton, WzLink, WzCard, WzSectionHeader, WzActionBar,
  WzUploadField, WzFieldError, WzNotice, WzSuggestionList, WzSuggestion,
  WzCalendarOutlineIcon,
} from "@/components/workiz";
```

## react-hook-form

| Control | How to wire it |
| --- | --- |
| `WzTextField`, `WzTextarea`, `WzSwitch`, `WzCheckbox` | `{...form.register("name")}` (native inputs; ref, name, onChange, onBlur all pass through) or plain `value`/`onChange` |
| `WzSelect`, `WzMultiSelect`, `WzTimeSelect`, `WzDateField` | `<Controller name="x" control={form.control} render={({ field }) => <WzSelect label="Job type" options={opts} {...field} />} />` — `onChange` gets the **value** (`""` when cleared; a `string[]` for multi), `onBlur` marks touched, `ref` focuses the input (`setFocus` works). The page's current pattern also works: `value={v.jobTypeId} onChange={(id) => form.setValue("jobTypeId", id)}` |

All controls also work uncontrolled (`defaultValue` / `defaultChecked`). A
`name` on the custom controls renders a hidden input, so native form posts
carry the value too.

## Components

### `WzTextField` — the floating-label text box
Reproduces `.sajInput` + `._fLabel` (new_01_empty, new_07_client_search,
formkit_focus_empty / formkit_hover_empty, job_b_01_details).

- Box 48px, 1px `#ccc`, 2px corners, padding 12px 10px 0, 16px/16px `#666`;
  focused edge `#ffd400` (0.3s). The wrapper is 3.04rem (48.64px) tall like a
  select, so rows of fields step 58.64px apart (10px gap) as in Workiz.
- Label: a real `<label for>`; at rest 16px/20px `#8c8c8c` at .95rem/.65rem;
  floats to 12px at top 2px on **focus, hover, or any value** (CSS on the
  input's own state, so `setValue`/`reset`/autofill move it without a render).
- Props: `label` (required), `error` ("Required field": 12px/10px `#e35a36`,
  4px below, 12px in; sets `aria-invalid` + `aria-describedby`),
  `endAdornment` (icons inside on the right; text stops 92px short),
  `inputClassName`, `className` (wrapper: width / `flex-1`), `overhang`
  (default `true`), `disabled`, and every `<input>` prop.
- `overhang`: Workiz's input is content-box sized, so a standalone box is
  **2px wider than its column** (599 in a 597 card; on the job page its
  columns are 1px narrower, so 454 in 453). Pass `overhang={false}` to keep it
  inside. Never applied inside a `WzFieldGroup`.
- Disabled (our locked primary phone): react-select's disabled greys
  (`#f2f2f2` fill, `#e6e6e6` edge), not-allowed cursor; adornment buttons
  stay clickable.

```tsx
<WzTextField label="Client name" {...register("name")} error={errors.name?.message} />
<WzTextField
  label="Phone" value={phone} disabled
  endAdornment={<><CallButton /><SmsButton className="-ml-[5px]" /></>}
/>
```
Job-page phone icons: 40×40 buttons, 7px down, 12px from the right, the second
overlapping the first by 5px (job_b_01_details).

### `WzFieldGroup` — fields drawn as one control
`join="seamless"`: New Job "Phone | Ext", "Address | Unit" — one box, no line
(the second laps 2px over the first with no left edge, as Workiz does, focus
included). `join="line"`: job page "First Name | Last Name" — one shared 1px
`#ccc` edge. `join="soft"`: job page "Phone | Ext" — a 1px `#cad3d6` divider
that stays put through focus. Members grow (`flex-1`); give the fixed one its
width: New Job Ext `className="w-[100px] flex-none"`, Unit `w-[151px]`, job page
Ext `w-[132px]` (131 + the divider).

```tsx
<WzFieldGroup join="seamless">
  <WzTextField label="Phone" {...register("phone")} />
  <WzTextField label="Ext" className="w-[100px] flex-none" {...register("ext")} />
</WzFieldGroup>
```

### `WzTextarea`
Custom-field notes ("Manager Note", new_01_empty_scroll1, formkit_textarea_focus):
1px `#ccc`, 4px corners, padding 7px 10px, 14px/18px `#666`, placeholder
inside in `#808080`, 100px tall, no resize grip, `#ffd400` edge focused. Named
by its placeholder unless given `aria-label`. Props: textarea props + `error`,
`wrapperClassName`. `{...register("note")}` works.

### `WzSelect` — react-select as Workiz styles it
new_01_empty, new_02..05_*_open, formkit_country_open / _filter /
formkit_select_hover / formkit_state_hover, job_b_01_details_scroll1.

- Control 48.64px, 1px `#ccc` (hover `#b3b3b3`), 4px corners or
  `shape="square"` (job page). Focused: the border goes and a 1px `#ffd400`
  ring is drawn outside — contents slide 1px left, exactly like Workiz.
- Empty: the label is the placeholder (16px `#808080`). With a value: the
  label floats (12px `#8c8c8c` at 10px/4px) over the value (16px `#333`).
  Typing hides both. Real `<label for>`; the input is `role="combobox"` with
  `aria-expanded`, `aria-controls`, `aria-activedescendant`.
- Indicators: optional clear × (`clearable`, job page Job source), 1px
  separator, chevron — react-select's own glyphs, `#ccc` → `#666` focused.
- Menu: 8px below, 4px corners, react-select's two-part shadow, max 300px,
  rows 32px (8px 12px, 14px `#404040`), focused `#deebff`, chosen
  `#2684ff`/white. Opens **below, always**, and scrolls the nearest scroller
  to make room (react-select scrolls the page rather than flipping).
- Keyboard (react-select's): type to filter (contains, case/accent-
  insensitive, catalog order), ↑/↓ (wrap; open on a closed menu), Home/End,
  PageUp/PageDown (±5), Enter or Tab picks, Escape closes, Space opens/picks
  on an empty input, Backspace clears when `clearable`. Mouse follows hover.
- Props: `label`, `options: {value,label,disabled?}[]`, `value` / `defaultValue`,
  `onChange(value)`, `onBlur`, `name`, `id`, `disabled`, `clearable`,
  `searchable` (default true), `filterOption` (`null` = filter on the server,
  pair with `onInputChange(text)` and `loading`), `noOptionsMessage`,
  `valueLabel` (shown for a value missing from `options`, e.g. an archived
  job type), `createOption={{ label?, onCreate(text) }}` (the "+ Add new" first
  row), `renderOption(option, {focused, selected})`, `shape`,
  `geometry` (`"labelled"` default — every Workiz select with a label is
  `.fLabel`, a 30px value box: placeholder 15.32px, value 24.32px down;
  `"plain"` for the bare job-page "Assign A Tech", 1px lower), `error`,
  `className`.

```tsx
<Controller name="jobTypeId" control={form.control} render={({ field }) => (
  <WzSelect label="Job type" options={types.map((t) => ({ value: t.id, label: t.name }))}
    createOption={{ onCreate: openNewTypeDialog }} {...field} />
)} />
<WzSelect label="Job source" shape="square" clearable value={sourceId} onChange={setSourceId} options={sources} />
```

### `WzMultiSelect` — "Assign team members" (new_06_team_open)
Same control and menu; picks become chips inside the box (white, 1px `#ccc`,
2px corners, 85% text, a × behind a `#ccc` rule — Workiz's
`.react-select__multi-value` overrides) and leave the list; Backspace drops the
last; a clear-all × when `clearable` (default, as react-select). Listbox is
`aria-multiselectable`. `value: string[]`, `onChange(string[])`; other props as
`WzSelect`.

### `WzTimeSelect` — the "At" time
formkit_time_open / _hover2 / _keyfocus2 / formkit_time2_open. 42px box, 1px
`#9ea6aa`, ink on hover, `#6aa8ee` while focused/open; notched label "At"
(11px ink on white, 8px in, 8px up); value 13px ink 12px in; thin chevron that
flips when open. List: 96 slots of 15 min ("03:30 PM"), **the chosen time is
left out and the list opens scrolled to the next slot** (Workiz does both);
rows 32px 13px ink, focused `#c2deff`; inner panel 8px corners with Workiz's
soft shadow. Typing "4:45" narrows to 04:45 AM / PM. Props: `label`, `value`
("HH:MM" 24h), `onChange("HH:MM")`, `step`, `options` (override slots),
`disabled`, `error`, `name`, `id`, `className`. Helpers: `wzTimeSlots(step)`,
`formatWzTime("15:30") === "03:30 PM"`.

### `WzDateField` + `WzCalendar` — Starts / Ends
formkit_date_open. 40px notched box (13px/23px ink, 0.15px tracking), MUI's
calendar button (40×32, `rgba(0,0,0,.54)`) at the right, labelled "Choose
date, selected date is Oct 8, 2026". The popup is MUI's DateCalendar look:
320×334 paper, "October 2026 ▾" + ‹ ›, S M T W T F S, 36px round days 2px
apart, chosen `#1565c0`, today ringed; ▾ opens a year list. Arrow keys move
by day/week. Typed text ("Nov 3, 2026", "11/03/2026", ISO) is read on blur or
Enter, nonsense is put back. Props: `label`, `value` ("YYYY-MM-DD"),
`onChange(iso)`, `min`, `max`, `disabled`, `error`, `name`, `id`, `className`.
Helpers: `formatWzDate`, `parseWzDate`. `WzCalendar` alone: `value`,
`onSelect`, `min`, `max`, `autoFocus`.

```tsx
<div className="grid grid-cols-[287px_287px] justify-between gap-y-6">
  <WzDateField label="Starts" value={v.scheduledDate} onChange={(d) => setValue("scheduledDate", d)} />
  <WzTimeSelect label="At" value={start} onChange={setStart} />
  <WzDateField label="Ends" min={v.scheduledDate} value={v.scheduledEndDate} onChange={…} />
  <WzTimeSelect label="At" value={end} onChange={setEnd} />
</div>
```
(New Job columns are 287px, job page 217px; rows 24px apart.)

### `WzSwitch` — the green Scheduled toggle
40×20, `#50d58c` on / `#bbbbbb` off, 16px white knob 2px in, 50ms; disabled
`#dddddd` / `#b2e5c0`; keyboard focus glows yellow round the knob. A native
`role="switch"` checkbox: `{...register("scheduled")}`, `checked` +
`onCheckedChange(bool)`, or `defaultChecked`. Name it with `aria-label`.

### `WzCheckbox` — "All-day event"
Workiz's box is the **browser's own** 13×13 checkbox (their SVG skin is a
`::before` Chrome never paints), 2px in / 3.2px down a 15px column; words
28.2px in, 14px/21px ink. Props: `label`, `onCheckedChange`, input props.

### `WzButton`, `WzLink`
`WzButton` (Button-module): `variant="primary"` (`#fad400`, hover `#eac300`,
pressed `#dcb802`), `"secondary"` (1px ink edge, hover `#f3f6f7`, pressed
`#c8ced0`), `"tertiary"`; `size="big"` (10.5px 20px → 40px; Create
`min-w-[150px]`, Save `min-w-[200px]`) or `"regular"` (6.5px 12px → 32px/34px:
Send, View schedule); text 13px/19px semibold ink, 0.2px tracking; `icon`
before the words (19px box; `WzCalendarOutlineIcon` is Workiz's View schedule
glyph); `loading` keeps the width under a spinner. Always `rounded-pill`.
Defaults to `type="button"`.
`WzLink tone="blue"` (Set recurring schedule: 14px `#6aa8ee` underlined),
`"bold"` (New Job Add phone: 12px semibold `#404040`, put `mt-[5px]`),
`"underlined"` (job page Add Phone: 12px medium `#404040` underlined, right
aligned, net 5px under the box). A `<button>`, or an `<a>` with `href`.

### `WzCard` — New Job card
White, 8px corners, `0 2px 8px rgba(0,0,0,.067)`, title 18px/23.4px medium ink
at 24px / 34px, content padded `0 24px 24px` with rows 10px apart (`pt-2.5`,
`gap-2.5`; override with `contentClassName`). `action` sits right of the title,
top-aligned (the Scheduled switch). A `<section>` named by its `<h5>`.
Page grid in Workiz: two 645px columns 30px apart at x=240, rows 30px apart.

### `WzSectionHeader` — job page section title
`<h4>` 18px/22px semibold `#404040`, 10px above/below, 1px `#cad3d6` rule, 20px
to the first field. `action`: a `WzSwitch` keeps Workiz's 16px line (41px
header, "Schedule"); a button centres (53px, "Team" + Send). Workiz sections
are 453px wide, columns at x=245 and x=898.

### `WzActionBar` — bottom bar
White, 15px above/below a 40px button, centred, `5px 1px 7px
rgba(50,50,50,.55)` shadow, z 100, `role="toolbar"`. Render it after the page's
scroll region (as the New Job page's footer is today) so it stays at the
bottom of the content column.

### `WzUploadField` — file custom fields
Title 14px medium `#404040`; thumbnails 58px (a `#ddd` 10px-cornered frame
under a 57px picture with a `#9ea6aa` 4px edge), 16px apart, a red ×
(`#ff6f64`) on hover to remove; the "+" tile 58×58 `#f7f8f8`, 1px `#9ea6aa`,
4px corners; caption "You can choose up to 5 files" 11px `#999`. Props:
`label`, `files: {id,name,url}[]`, `onAdd(File[])` (already trimmed to what
`max` leaves), `onRemove(id)`, `onOpen(id)`, `max` (5), `accept`, `disabled`.

### `WzFieldError`, `WzNotice`
`WzFieldError`: "Required field" (12px/10px regular `#e35a36`, 4px down, 12px
in) — the fields render it for you via `error`. `WzNotice`: "Please select a
service area to display available techs" (12px/14px semibold `#e35a36`; Workiz
puts it 15px under the team select).

### `WzSuggestionList` + `WzSuggestion` — client-name search dropdown
new_07_client_search: hung straight under the text field (put both in a
`relative` box and give the list `className="top-12"`), column-wide, max 400px,
`#ccc` bottom rule. Each row is its own 1px `#ccc` box (neighbours show a 2px
line, as in Workiz), padding 15px 10px, title 16px `#404040` with the typed
part bold, grey 14px subtitle 10px under; hover / `active` `#deebff`.
`<WzSuggestion addNew title="+ Add new" query={text} />` renders
`+ Add new "Dustin"`. Rows keep focus in the input on press. Keyboard
navigation is the caller's (it owns the input); `splitMatch(text, query)` is
exported.

## The app-wide kit (2026-10-08, agent `uikit`)

The whole app is to look like Workiz. Two layers do it:

1. **`components/ui/*` are Workiz now.** Every screen that imports `Button`,
   `Input`, `Select`, `Table`, `Dialog`… gets the Workiz look without being
   touched. Same exports, props and variants as before.
2. **This folder adds the pieces with no shadcn counterpart** (list chrome,
   the Actions menu, the side drawer, tab rows, the rail), lifted from the
   jobs pages so every list and record page can share them.

Spec with every measurement and capture name:
`workiz-data-parser/docs/import/jobs-parity-2026-10-08/uikit.md`.

### What `components/ui` maps to

| Primitive | Workiz look |
| --- | --- |
| `Button` | Button-module. `default` / `brand` → yellow primary pill; `outline` → secondary (1px ink edge); `ghost` → tertiary; `secondary` → blue accent pill; `destructive` → red danger pill (#f45e44); `link` → #6aa8ee 13px/600. Sizes: default 32px (regular), `sm` 26px (compact), `lg` 40px (big), `xs` 24px; `icon*` are IconButton squares (24 r4 / 32 r8 / 40 r8); outline + icon = the toolbar's square #ccc button. Disabled = #eff1f1 / #9ea6aa, not faded. |
| `Input`, `Textarea` | 40px box, 1px #ccc (#b3b3b3 hovered, #ffd400 focused), 4px corner, #808080 placeholder, Workiz disabled greys, #e35a36 when invalid. Label stays above (the 48px floating-label field is `WzTextField`). |
| `Select` | react-select: same box; focused/open = no edge + 1px #ffd400 ring; 1px separator + #ccc chevron; menu 8px below, two-part shadow, 14px rows, #deebff focused, #2684ff chosen. `size="sm"` 32px, no separator. |
| `Label` | 13px/500 ink. |
| `Checkbox` | the browser's 13px box, #767676 edge, ticked #6aa8ee. |
| `Switch` | 40×20 green #50d58c / #bbbbbb, 16px knob. |
| `Tabs` | `default` = scheduler segmented box; `line` = small tabs (13px, 2px bar); `page` (new) = big tabs (16px, 3px bar). |
| `Table` | react-table grid: 41px #f7f7f7 header with solid #ccc rules, 20px top-aligned cells with dotted #cfcfcf rules, zebra, rgba(0,0,0,.05) hover over the zebra too; `TableHead sort="asc"\|"desc"` (new) draws the 3px bar + `aria-sort`; `density="compact"` (new, the default inside Dialog/Sheet) packs cells to 12px / 8px. |
| `Dialog`, `AlertDialog` | modal: 16px corners, 24px in, `0 3px 9px rgba(0,0,0,.5)`, black 30% backdrop **without blur**, 18px/600 title, footer on white with big 40px buttons. |
| `Sheet` | side drawer: #666 at 60% backdrop **without blur**, soft edge shadow, 422px, 18px/600 title, #607890 ×. |
| `DropdownMenu` | the Actions menu: 216px min, 2px corners, its shadow, 50px slate rows ruled #cad3d6; check/radio items read like react-select options. |
| `Tooltip` | MUI dark chip: ink, r4, 8px 12px, 12px/500 white, no arrow. |
| `Badge` | 11px/500 chip, 1px 4px; `secondary` #6aa8ee, `destructive` #f45e44, `outline` white #ccc. |
| `Card` | New Job card: r8, `0 2px 8px rgba(0,0,0,.067)`, 24px in, 18px/500 title. |
| `ListPagination` | `WzPager` + a Workiz page-size box. No page numbers (Workiz has none). |
| `Toaster` | redux-toastr colours: success #83c795, error #f45e44, warning #f7a336, info #58abc3, 440px, top-centre. |
| `Command` | options like react-select's. |
| shell breadcrumb | 11px/400 capitals, all ink, 20px in, no rule. |

### Kit components

- **`WzPager`** `pager={Pager}` `end={…}` `loading` `nav` — the list footer
  ("Showing 1 to 50 of 208 results", ‹ "Page 1 of 5" ›). `wzPagerSummary`,
  `wzPagerPages` give the words.
- **`WzListToolbar`** — the 71px #f7f7f7 strip; **`WzSearchBox`** `value`
  `onChange` — the 348×40 Search with the round ×; **`WzPageSizeSelect`**
  `value` `sizes` `onChange` — the native 75×34 box; **`WzToolbarButton`** —
  "Export" / "Fields" (34px, #ccc, see-through).
- **`WzDrawer`** `open` `onOpenChange` `title` `trigger` `footer` — the
  "Visible fields" panel (opaque footer); **`WzDrawerSection`** `title` —
  "USED FIELDS".
- **`WzActionsMenu`** `items={{key,label,icon,onSelect,destructive}[]}` —
  "Actions ▾" with Workiz's caret.
- **`WzTabBar`** `variant="small"|"page"|"job"` `tabs={{value,label,count,sublabel}[]}`
  — the three Workiz tab rows, with arrow-key navigation.
- **`wzPill(tone, size)`** — the job page's 34px pill classes for non-button
  elements (identical to `features/deals/components/job-pills.ts`).
- **`WzTableEmpty`** `title` `art` — the white wash + "No Jobs Found".
- **`WzFilterChip`** `label` `colorClassName` `onRemove` — "tag: Needs a call ×".
- **`WzRail`** / **`WzRailButton`** / **`WzRailPanel`** — the right rail strip,
  its icons (red count, optional caption) and the 350px panel chrome.

## The legacy report kit (2026-10-08, agent `rep_jobstats`)

Several Workiz reports (Job Statistics first) are old PHP pages Workiz
iframes into its app: a grey (#f7f7f7) page with Developr-theme controls,
Chart.js 2 charts and DataTables grids. Captures `rep_jobstats_wz_*`; notes
`workiz-data-parser/docs/import/app-parity-2026-10-08/rep_jobstats.md`.
Import each from its file (`@/components/workiz/<file>`).

- **`WzButtonGroup`** (`button-group.tsx`) `options` `value` `onChange`
  `aria-label` — `span.button-group` radios ("By Time: Created | Scheduled |
  Closed", "Day | Week | Month"): 32px, 13px, #ececec with 2px white rules,
  the chosen one #ddd. A radio group with arrow keys.
- **`WzPeriodPicker`** (`period-picker.tsx`) `presets` `preset` `range`
  `onPresetChange` `onCustomChange` `today` — `.date_picker_gen`: a 262px
  #ddd box, the period's name over "Oct 01 , 2026 - Oct 08 , 2026"; the
  presets hang under it (35px rows, #e1e1e1 hover); Custom adds From / To
  inputs that open Workiz's Glow calendar and apply once both are picked.
  `wzRangeText(from, to)` prints the days.
- **`WzLegacySelect`** (`legacy-select.tsx`) `options` `value` `onChange`
  `searchable` `aria-label` — `span.select.replacement`: 32px #f7f7f7 box,
  1px #ccc, a 26px chevron box; the list hangs on a caret, chosen row
  rgba(0,0,0,.75); `searchable` puts a "Search" box in the control.
- **`WzTagFilter`** (`tag-filter.tsx`) `tags={id,name,className}` `selected`
  `onToggle` `after` — the tag cloud: 11px capital chips on their colour,
  rgba(0,0,0,.75) when chosen; `after` sits on the last line.
- **`WzStatList`** (`stat-list.tsx`) `items={key,value,caption:[a,b]}` —
  `ul.stats`: 72px rows, a 48px light figure, a two-line 16px caption.
- **`WzBarChart`**, **`WzPieChart`** (`charts.tsx`) — Chart.js 2 redrawn in
  SVG with its own geometry (read off Workiz's live `Chart.instances`):
  12px 'Helvetica Neue' #666, top legend of 40×12 boxes, `beginAtZero` ticks
  (`chartTicks`, `tickLabel`), labels tipped to 50° and thinned when crowded
  (`xLabelLayout`), bars at 80% × 90% of their category, Chart.js's tooltip;
  pies 2:1 with a centred legend below (`legendLines`, `pieLayout`) that
  swallows the pie when too long, as Workiz's does; "No data found" without
  slices. Each draws an sr-only table of its numbers.
- **`WzDataTable`** (`data-table.tsx`) `columns` `rows` `footer` `sort`
  `onSort` `search` — DataTables: 14px/500 #666 header boxes (#0059a0
  hovered, ▼/▲ on the sorted one), 13px rows ruled #e6e6e6 / dotted #cfcfcf,
  the sorted column #f1f1f1, a Totals footer, "No Records Found", and the
  optional "search" strip.
- **`WzTabBar variant="legacy"`** — `standard-tabs`: 16px/500, 15px 45px, a
  4px #3e4b51 bar; give the row `-mb-px` over the white #ccc-edged box.

## Known differences from Workiz (deliberate or unmeasurable)
- Sub-pixel: Workiz's own fractional layout makes some glyphs land ±1px
  differently from ours in screenshots (e.g. two Workiz selects with identical
  CSS place their placeholder 15 vs 16px down). Boxes, colours and type match.
- Filtering matches the label only; react-select also matches the value,
  which here is an id nobody should be able to type into.
- `WzTimeSelect` opens showing the slot after the chosen time while its
  keyboard focus sits on the list's first slot (12:00 AM), so ↓ jumps to
  12:15 AM — that is what Workiz does (formkit_time_open's live region says
  "12:00 AM, 1 of 95"); kept for parity. Hovering a row moves the focus there.
- Disabled text fields/selects: Workiz shows none on these pages; we use
  react-select's disabled greys so a locked field reads as locked.
- Built on Radix Popover with our own combobox logic, not cmdk: cmdk's
  `Command.Input` forces `aria-expanded="true"`, overwrites the input id and
  labels it with its own hidden label (so a real visible `<label for>` is
  impossible), swallows Enter on a closed menu and reorders DOM while
  filtering.
