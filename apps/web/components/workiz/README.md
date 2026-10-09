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

### `WzOutlinedSelect` — a select in the notched outline (Add time off)
pg_schedule_wz_13_timeoff_open (agent `pg_schedule`): the "Select user" and
"Reason" selects of Workiz's newer modals — react-select in its FloatingLabel
shell, the same 42px box as `WzTimeSelect` (1px `#9ea6aa`, ink hovered,
`#6aa8ee` open), the value 13px ink 12px in, a thin chevron, the time list's
32px 13px menu. With a `placeholder` the label sits in the notch from the start
("Select user" over "Select user"); without one it rests inside until a pick
("Reason"). Unlike the time list the chosen option stays listed. Props:
`label`, `placeholder`, `options: WzOption[]`, `value` (`""` = none),
`onChange(value)`, `onBlur`, `name`, `id`, `disabled`, `error`, `className`.
`OUTLINE` and `NotchedLabel` are exported from `outlined.tsx` for it.

```tsx
<WzOutlinedSelect label="Select user" placeholder="Select user" options={techs} value={techId} onChange={setTechId} />
<WzOutlinedSelect label="Reason" options={reasons} value={reason} onChange={setReason} />
```

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
  `WzRailButton active` (new) is the client page's open-panel tile (`#f3f6f7`,
  r6, `aria-pressed`); with `caption` the count rides the 54px tile's corner.
  `WzRailPanel variant="plain"` (new) is the client page's white panel: the
  18px/27px 600 title 16px in, a thin × at the right, no grey cap.

### Section-page pieces (agent `callspage`, Workiz Phone)

Measured off `callspage_wz_*` (notes: `jobs-parity-2026-10-08/callspage.md`).

- **`WzPageHeader`** `title` `pill` `end` — h2 25px/32px 500 ink, 24px in;
  **`WzHeaderPill`** `icon` — the grey 36px pill beside it (`#f3f6f7`, r8).
- **`WzTabLinks`** `tabs={{id,label,href}[]}` `active` `label` — Workiz's
  legacy tab strip as *links* (sub-routes): 13px, 15px 25px, idle 500
  `#768287`, open 600 `#404040` over a 4px `#3e4b51` bar, 1px `#ccc` rule.
  `WzTabBar` stays the one for in-page tabs.
- **`WzStatCard`** `label` `value` `aside` `alert` — StatCard-module: 1px
  `#e8e8e8`, r8, 16px; 10px/500 capitals over a 25px/500 number; `alert`
  turns both `#f45e44` (MISSED CALLS > 0). Cards share a row with `flex-1`.
- **`WzBadgeIconButton`** `label` `icon` `count` — the 40px grey icon button
  with the red 22px count (the headset "Monitor calls").
- **`WzDateRangePicker`** `presets` `value={preset,from,to}` `rangeOf`
  `onChange` — the 250px `._picker` box: preset name over "Oct 8th, 2026 -
  Oct 8th, 2026", a 37px-row list under it, Custom → From:/To: MM/DD/YYYY
  inputs (read on blur/Enter, nonsense put back, To follows From).
  `formatWzDay`, `formatWzDayRange`, `formatUsDay`, `parseUsDay`, `ordinal`.
- **`WzAddFilter`** `kinds` `onAdd` — "+ Add filter" (32px r20 tertiary) and
  its 274px menu with "Search filters"; **`WzFilterField`** `name` `value`
  `open` `onOpenChange` `onRemove` — the grey "Direction is (any) ⌃ ×" chip
  (`#dfe2e3`, 13px `#6aa8ee`) with its panel; **`WzFilterOptions`**
  `searchLabel` `options` `selected` `multi` `onApply` — the panel: search,
  36px rows (Select All when `multi`; radios when the filter takes one
  value), "Apply" (14px/600 `#3589e9`). (Not the same as `WzFilterChip`, the
  react-select multi-value chip of "Filter results".)

### Report pieces (agent `rep_jobs`, Jobs report)

Measured off `rep_jobs_wz_*` (notes:
`workiz-data-parser/docs/import/app-parity-2026-10-08/rep_jobs.md`). Import
them from their files (`@/components/workiz/grouped-filter`, …).

- **`WzGroupedFilter`** `groups={{key,label,chip,options:{value,label,className?}[]}[]}`
  `value={[key]: string[]}` `onChange` `chipOrder` — the reports' "Filter
  results" react-select (Jobs report MultiFilter): 38px box, "Select..." 16px
  `#808080`; open, one 150px column per group side by side (headings 10.5px/500
  `#999` capitals, 32px options, `#deebff` focused), 300px tall, scrolling both
  ways; typing in the box narrows every group and drops the empty ones; a pick
  closes the list and becomes a chip "`chip`: label" (24px white, 1px `#ccc`,
  11.9px `#333`, a × segment); Backspace drops the last chip, the clear × all.
  `className` on an option draws it as a coloured chip (tags). `wzFilterChips()`
  gives the chip words and order.
- **`WzPickerSelect`** `prefix` `options` `value` `onChange` `attached` — the
  `_picker` select row "By: Job end date ⌄" (36px, thin chevron 29px from the
  right) with its 37px-row list; `attached` (default) sits flush under a
  `WzDateRangePicker`. Give both the same width (250px, 362px with Custom).
- **`WzDateRangePicker` `calendar={{today}}`** (new, optional) — hangs
  **`WzDayPicker`** under a focused From: / To:: react-datepicker's stock month
  (242×235, `#f0f0f0` header, 27px days, chosen `#216ba5`, today bold, only the
  weeks the month touches); a picked day is taken at once. Off by default.
  The list under the box: no shadow, `#e1e1e1` under the cursor (measured,
  rep_jobs_wz_06b_date_hover).

### Report grid (agent `rep_activity`, Activity report)

Measured off `rep_activity_wz_*` (notes:
`workiz-data-parser/docs/import/app-parity-2026-10-08/rep_activity.md`).

- **`WzReportGrid`** (`report-grid.tsx`) `columns={{id,label,width?,sortable?,cell}[]}`
  `rows` `rowKey` `sort={{column,dir}|null}` `onSort(column)` `loading` `busy`
  `emptyText` `footer` — react-table's report grid for any report whose
  server pages and sorts: 1px `#ddd` frame, 42px `#f7f7f7` header (sticky,
  solid `#ccc` rules, the 3px sort bar), 20px top-aligned cells cut at the
  edge, dotted `#cfcfcf` rules, zebra, hover `.05`; never shorter than ten
  rows (blank 56px rows over a `.05` rule); "No Records Found" 204px down
  with the band's right edge on the middle; `loading` = header and blank rows
  under a white-80% veil with three 13px ink dots. Columns without `width`
  share the width alike (Workiz's `flex: 100`). `footer` puts the pager inside
  the frame, right under the rows, as `.pagination-bottom`. Workiz opens a
  report unsorted (`sort={null}`: no bar); **`wzNextSort(dir)`** gives
  react-table's click (unsorted → asc → desc → asc).
- **`WzDateRangePicker` `rangeText={(value) => string | undefined}`** (new,
  optional) — words in place of the days: Activity's "All time" box reads
  "All time" twice (Workiz sends no dates for it).
- **`WzPager` `plainNumbers`** (new, optional) — "Showing 1 to 10 of 4392
  results", "Page 1 of 440": react-table prints its counts without thousands
  separators, in every Workiz capture (370338, 8806…). Off by default so
  existing lists keep theirs; the coordinator may flip it kit-wide.

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

### List-page pieces (2026-10-08, agent `pg_contacts`, Clients list)

Lifted from Workiz's Clients page (`pg_contacts_wz_*` captures); any list
page can use them.

- **`WzKpiCard`** (`kpi-card.tsx`) `value` `caption` `tone="ink"|"orange"|"red"` `label` — the
  KPI card over a list (`._fCard`): 81px, 15px in, a 3px left rule (ink /
  `#ffae00` / `#dd380d`), MUI elevation-2 shadow, the number 19.6px/25px 500
  `#3e4b51` over a 14px `#999` caption, right-aligned. A figure, not a button
  (Workiz's clickable cards open reports we may not have). Lay four out with
  `grid grid-cols-4 gap-[31px] px-5`. **`WzKpiCardSkeleton`** `tone` — the
  same box with grey bars.
- **`WzFilterSelect`** `groups={{id,title,chipPrefix,options:{value,label,colorClassName}[]}[]}`
  `value={{group,value}[]}` `onChange` — "Filter results" for a list
  (pg_contacts_wz_03/12): 38px react-select box, yellow ring when open, picks
  as `WzFilterChip`s ("tag: PLATINUM ×"), clear-all ×, chevron; the menu lays
  the groups side by side 8px under it (10.5px `#999` capitals, 32px rows,
  coloured values as chips). Type to narrow, ↑/↓/Enter, Backspace drops the
  last chip. The jobs list keeps its own richer control
  (`features/deals/components/jobs-filter-control.tsx`). Helper:
  `filterSelectGroups(groups, picked, query)`.
- **`WzFieldsPanel`** `options={{id,label,icon}[]}` `used={ids}` `onSave(ids)`
  `trigger?` — the "Visible fields" drawer for any list (pg_contacts_wz_08,
  list_02): the strip's "Fields" button opens it; "Search fields", USED FIELDS
  (drag handles, ticks, glyphs), UNSELECTED FIELDS, Cancel / yellow "Save
  fields" (disabled with nothing ticked). Helpers: `fieldsPanelLists`,
  `toggleField`, `moveField`. (The jobs list's `FieldsMenu` predates it.)
- **`WzTableNoData`** `children="No Records Found"` — react-table's empty note
  over a report grid's blank rows (pg_contacts_wz_05_search_empty): 15px/500
  `#404040` on a white-70% band, 203px under the grid's top. Put it in the
  grid's `relative` frame. (Jobs has the bigger `WzTableEmpty`.)

## Workiz Home: widgets and charts (2026-10-08, agent `pg_dashboard`)

Measured on `/root/home/` — captures `pg_dashboard_wz_*` (+ `.deep.json`, every
element of every widget) under `jobs_parity_2026-10-08`, notes in
`docs/import/app-parity-2026-10-08/pg_dashboard.md`. Colours are the
`wzChart*`, `wzStat*`, `wzDash*`, `wzPieYellow`, `wzSeries1..8` tokens.

- **`WzWidget`** `title` `updatedAt?` `help?` `onRefresh?` `refreshing?`
  `menu?={key,label,onSelect}[]` `viewAll?={href,label?,underline?}` — the
  350px card: 51px header (16px/600 title, "updated 3:06 PM" only when given,
  18px #404040 glyphs: `?` with Workiz's blue MUI tooltip only when `help`,
  mirrored refresh, kebab menu 196px), body 17px 20px, "View All" pinned 25px
  in from the bottom-left. A `<section>` named by its `<h2>`.
- **`WzRangeSelect`** `label` `value` `options` `onChange` — "Last 14 Days ⌄"
  (14px #a0a0a0, capitalised, CSS chevron); the 195px list hangs right-aligned
  under it (`menuitemradio`s). Workiz's ranges are `DASHBOARD_PRESETS` /
  `dashboardPresetWindow` in `@bitcrm/types`.
- **`WzWidgetStat`** `label` `value` `sub?` `rule?` `layout="row"|"stacked"` —
  Jobs / Today / Estimates rows (39px, 28px #6d6d6d figure, optional 2px
  coloured left rule) and the Invoices block (capitals + 28px/42px amount).
- **`WzChartLegend`** `items={label,color,value?}[]` — 6px dots, 14px #666.
- **`WzWidgetBarChart`** (`widget-charts.tsx`) `title` `days` `series={label,color,values}[]` `format?` —
  chart.js 2's look: Helvetica 12px #666 ticks (no tracking), #e5e5e5 axis
  with 10px tick marks, no grid, nice steps (`wzChartTicks`), every day
  "Sep 24th" tilted as chart.js would (`wzAxisLabels`), groups 80% of a slot,
  round-topped, black tooltip; a day is a tab stop; numbers also as a table.
- **`WzWidgetLineChart`** — the same axes, chart.js's tension-.4 curve
  (`wzSpline`) with 3px rings, "09/24/26" labels.
- **`WzWidgetPie`** `title` `slices={key,name,count,percent}[]` — the 71px pie with
  white seams and the 2×2 legend (left column ruled left, right column ruled
  right and flush right). Workiz picks slice colours at random on each load;
  `WZ_PIE_COLORS` fixes an order from the same palette.

Colours on these take CSS values (`var(--wz-chart-done)`), not classes, so a
series can carry any token. Tooltips open the way chart.js 2 opens them
(`wzTipSide`: level with the point towards the chart's middle, under a point
near the top) with its 5px caret.

Letter-spacing inside a widget is Workiz's, not the app's 0.4px: body text
0.075px, stat labels 0.167857px, 28px figures 0.223809px, pie names
-0.072px, pie percents 0.45px (the `.deep.json` captures). The body box is
97.76% of the card (`pr-[calc(20px+2.24%)]`), as Workiz's grid column is.

`WzDrawer` has a `head="band"` option (default `plain`, unchanged): Workiz's
older right pane — a 49px #f7f7f7 band with the title centred and a #eeeeee
rule — used by the dashboard's "Dashboard widgets" panel.

### Payments report pieces (2026-10-09, agent `rep_payments`)

Measured off `rep_payments_wz_*` (notes:
`workiz-data-parser/docs/import/app-parity-2026-10-08/rep_payments.md`).

- **`WzTotalCard`** (`total-card.tsx`) `value` `caption` `label` — the
  Payments report's card (`PaymentsReport-module__cardContainer`): 188×72,
  white, 8px corners, `rgba(59,75,82,.05) 0 0 4px, rgba(59,75,82,.1) 0 4px
  12px`, a 4px ink bar on the left; the figure 16px/24px 500 ink (0.2px
  tracking) over a 14px/21px `#768287` caption, 16px from the bar and the top.
  Two sit 40px apart, 100px after the page's h3.
- **`WzGroupedFilter`** (additions): a group with `chip: ""` prints its chips
  as the bare name ("Cash"); an option's `color` (`#rrggbb`) draws it as a
  chip of that colour in the list (a service area); `chipColored` on a group
  keeps that colour on the chip a pick leaves ("metro: SURE LOCK CT", white
  11.9px/500 on the colour, the × too, inside the white #ccc box).
- **`WzDateRangePicker` `rangeText`** (new, optional) — the days line for a
  period without days: Workiz's "All time" box reads "All time" over
  "All time". **`customError`** (new, optional) — Workiz's refusal inside the
  box under From / To ("Date range exceeds 12 months", 14px `#ff0000`, 5px
  in), only while Custom is open.

### Items report pieces (2026-10-09, agent `rep_items`)

Measured off `rep_items_wz_*` (notes:
`workiz-data-parser/docs/import/app-parity-2026-10-08/rep_items.md`). All
additive; every existing caller is untouched.

- **`WzReportGrid` `renderExpanded={(row) => ReactNode | null}`** —
  react-table's SubComponent: what a record opens under its row (the Items
  report's jobs of an item), one cell across every column, white over the
  zebra, no hover, no padding; the zebra keeps counting records (a hidden
  spacer row follows the box), and a record holding an open
  `aria-expanded` control keeps its stripe instead of the "menu open" grey.
- **`WzReportGrid` `minRows`** (default 10; the Items drill-down's 5 — the
  loader's dots then sit halfway down), **`stickyHeader`** (default on; off
  for a grid nested in another), **`padRowRule`** (default on: 57px blank rows
  over the faint .05 rule; off: Workiz Items' 56px rows without it).
- **`WzReportColumn.headerClassName`** — classes on the header's words: the
  Items report's "Item" is react-table's plain header, `"text-center
  font-normal"`.
- **`WzGroupedFilter` `size="tall"`** — the Items report's "Filter results":
  48.64px (react-select's 3.04rem), the same height under the yellow ring.
- The ▸ itself is react-table's `.rt-expander` drawn in CSS (a 7px
  rgba(0,0,0,.8) triangle in a 10px box with 10px margins, turning down in
  .3s on the overshooting curve) — see `features/reports/items/components/items-report-table.tsx`.

### Record-page pieces (2026-10-09, agent `pg_contact`, the client page)

Lifted from Workiz's client page (`pg_contact_wz_269669_*`, notes:
`workiz-data-parser/docs/import/app-parity-2026-10-08/pg_contact.md`); any
record page with tabs of grids can use them.

- **`WzLocalGrid`** (`local-grid.tsx`) `label` `columns={{id,label,width?,render,sortValue?,searchText?,cellClassName?}[]}`
  `rows` `rowKey` `defaultSort={{id,dir}}` `searchLabel` `toolbar` `onRowClick`
  `rowClassName` `footer` — a react-table grid whose rows are all in hand: the
  71px strip (Search, the caller's `toolbar` pieces, page size 5…100 with 10
  first), the 1px #ddd frame, fixed columns at their `width` (Id 130) and the
  rest sharing the row but never under 100px (past that it scrolls sideways),
  headers that sort on click (asc first, then flip; blanks last) with the 3px
  bar + `aria-sort`, cells 20px all round clipped with "…", rows padded to ten
  57px blanks, "No Records Found" over them, `WzPager` under it. The logic is
  `localGridView(rows, columns, {query, sort, page, size})` and
  `nextGridSort(sort, id)`.
- **`WzTotalsBar`** `aria-label` + **`WzLeftBorderBox`** `label` `value` `tone="danger"`
  (`record-parts.tsx`) — the totals over a record's tabs (`LeftBorderBox`): a
  10px/14px 500 #9ea6aa capital caption over a 28px light (300) figure, red
  #f45e44 for `danger`; the first 76px in, each next 80px after the last.
- **`WzFold`** `title` `defaultOpen` `action` — a folding section of a record's
  left column ("> Addresses", "Additional contacts (6) +"): 1px #dfe2e3 rule,
  chevron 19px in, 14px/21px 600 title, the `action` outside the title's button.
- **`WzSegmented`** `options` `value` `onChange` `aria-label` — the Files
  panel's All | Media | Documents switch (#f3f6f7 box, the chosen part white,
  14px 600 #6aa8ee, soft shadow); a tab list.

## Cards that are the filter (2026-10-09, agent `rep_aging`, Aging invoices)

Measured off `rep_aging_wz_*` (notes:
`workiz-data-parser/docs/import/app-parity-2026-10-08/rep_aging.md`).

- **`WzKpiCard` `onSelect` `selected`** (new, optional) — the same `._fCard`
  as a toggle button (`aria-pressed`, named by `label`): under the cursor the
  shadow drops to `0 12px 12px -8px rgba(0,0,0,.4)` (`.c_hover`), the chosen
  card sits on `#f0f0f0` (`.selectedCard`). Laid out from the top with the
  caption 10px under the figure (glyph rows 144–162 / 176–192, as Workiz).
  Without `onSelect` the card is the plain figure it was.
- **`WzKpiTone` `"lightYellow"`** (`#ffd57b`, under 30 days) and
  **`"lightRed"`** (`#ff7753`, 60-90 days) — Aging's `lightYellowCard` /
  `lightRedCard` rules, beside ink / `#ffae00` / `#dd380d`.
- Five across: `grid grid-cols-5 gap-[18px] pt-[34px] pr-[19px] pb-[75px] pl-[30px]`
  (256px cards at 1400). A strip without Search is `WzListToolbar
  className="min-h-[65px]"` (Workiz's is 65px there).

## Map pieces (2026-10-09, agent `pg_dispatch`, Workiz Map)

Measured on `/root/map` (captures `pg_dispatch_wz_*`, notes
`docs/import/app-parity-2026-10-08/pg_dispatch.md`) and its main.css
(MapPin-, MapPinGroup-, Marker-, SwitchTabs-, Toggle-module). Import each from
its file.

- **`WzMapPin`** (`map-pin.tsx`) `color?` `label?` `name` `more?` `tooltip?`
  `dim?` `children?` — the 42×48.5 teardrop pin (SVG, 3px white edge, blurred
  14×5 shadow, .9 hovered) with 16px/24px semibold letters at 45% height;
  no `color` = the slate (#566d76) "Unassigned" pin with the blocked-person
  glyph; `more` adds the slate "+N" pin 12px under its right edge; `tooltip`
  shows `name` in the MUI chip 14px over it. Put it in an AdvancedMarker
  (bottom-centre anchor). **`wzPinInitials(name)`** — first character of the
  first and last word ("(2) CT - Tyler Boucher" → "(B"); **`wzPinInk(fill)`**
  — ink letters when they out-contrast white (Workiz's own choice on every
  pin); **`WZ_UNASSIGNED_PIN`**.
- **`WzMapPinCard`** `title` `actions={label,icon,onClick}[]` `onClose` — the
  card a pin opens: 363px, 12px corners, `0 4px 16px rgba(0,0,0,.15)`, 10px
  over the pin with a 5px arrow; 18px semibold title beside 20px glyphs 14px
  apart and the ×; rows 14px/21px 12px apart. **`WzMapPinCardRow`** `icon`
  `end` `rule` — a row with a 20px glyph 8px before the words, something at
  the right, and the rule under the phone line. Render it as `WzMapPin`'s child.
- **`WzSwitchTabs`** (`switch-tabs.tsx`) `tabs` `value` `onChange` — the
  "Jobs | Techs" switch: #f3f6f7 box, 2px in, equal tabs 10px 30px, 13px ink;
  the chosen one white, 2px corners, soft shadow, 14px semibold #6aa8ee.
  Arrow keys move. (Not `WzTabBar`, which draws underlined tab rows.)
- **`WzMiniToggle`** `label` `checked` `onCheckedChange` — the 32×16
  Toggle-module switch ("Show leads"): `wz-tag-success` (#3acf7d) on,
  #768287 off, a 12px knob, .4s. (`WzSwitch` is the 40×20 Scheduled toggle.)

## Tax report (2026-10-09, agent `rep_tax`)

Measured off `rep_tax_wz_*` (notes:
`workiz-data-parser/docs/import/app-parity-2026-10-08/rep_tax.md`). Built
from the kit as it stood — `WzTabBar` small (Accrual / Paid),
`WzOutlinedSelect` ("Tax to show" is the same FloatingLabel select, 480×42),
`WzDateRangePicker` + `WzPickerSelect` (the Jobs report's box), the strip,
`WzReportGrid` + `WzPager plainNumbers` — with one addition:

- **`WzReportGrid` `plainFiller`** (new, optional) — the blank rows under
  records as Workiz draws them: 56px with no rule (rep_tax_wz_01_default:
  five records + five blanks, every row-group 56px, `border-bottom: 0`). The
  57px ruled blanks stay on an empty grid (rep_tax_wz_11b_search_empty). Off by
  default so the grids before it keep their blanks; every Workiz capture with
  records over blanks shows the 56px kind, so the coordinator may flip it
  kit-wide.

## Status cards (2026-10-09, agent `pg_estimates`, the Estimates list)

Measured off `uikit_wz_estimates` and `pg_estimates_wz_*` (notes:
`workiz-data-parser/docs/import/app-parity-2026-10-08/pg_estimates.md`). Both
props are optional; every existing card is untouched.

- **`WzKpiCard` `wrapCaption`** — the Estimates page's card prints the status
  big over "50 Worth $8,702,853.93", and that caption wraps instead of being
  cut: the card is 81px with one line and 97px with two (`min-h-[81px]`). Lay
  them out with `items-start` so a one-line card is not stretched to its
  neighbour: `grid grid-cols-6 items-start gap-[31px] px-5 pt-[34px]`.
- **`WzKpiCard` `selectedTone`** — the chosen card's rule instead of Aging's
  chosen grey: on the Estimates page the picked card turns `left-orange`
  (`selectedTone="orange"`, #ffae00) and stays white
  (pg_estimates_wz_06_card_won). A second click there keeps the pick — the
  card sets the status filter, it does not toggle it.

## List grids that open records (2026-10-09, agent `pg_invoices`, Invoices list)

Measured off `pg_invoices_wz_*` (notes:
`workiz-data-parser/docs/import/app-parity-2026-10-08/pg_invoices.md`). All
additive; callers without the new props are untouched.

- **`WzReportGrid` `onRowClick={(row, event) => …}`** — react-table's
  `rt-tr-group pointer`: the whole record opens something (the Invoices list's
  row → the invoice). Records get `cursor-pointer` and a tab stop; a click, a
  middle click (`event.button === 1`) or Enter on the focused row calls it —
  check `metaKey` / `ctrlKey` / `button` for a new tab. Blank filler rows stay
  inert; links inside a row stop their own clicks.
- **`WzReportGrid` `resize={{ widthOf, setWidth, reset }}`** — Workiz's headers
  are `rt-resizable-header`s: every header gets `ResizableHead`'s drag handle
  (`resize-<id>`, arrow keys, Home / double-click resets) and the `<col>`s take
  `widthOf(id)`. Pair it with `useColumnWidths(table, defaults)`; the sort bar
  and `aria-sort` stay.
- **`WzSearchBox`** now turns its edge ink under the cursor (Input-module
  hover, pg_invoices_wz_05b_search_hover / rep_activity_wz_07c_search_hover);
  focus still wins with #6aa8ee.
- The Invoices cards are the Estimates ones: `WzKpiCard selectedTone="orange"`
  (Workiz's `left-orange` on the last card clicked, pg_invoices_wz_10_card_overdue).

## Finance Reporting pieces (2026-10-09, agent `rep_commission`, Commissions)

Workiz's "Commissions (Legacy)" is another legacy PHP page in an iframe
(`/finance_report/?iframe=true`) — white, with Developr controls and a
server-side DataTables grid. Measured off `rep_commission_wz_*` (notes:
`workiz-data-parser/docs/import/app-parity-2026-10-08/rep_commission.md`).
Import each from its file; nothing new in `index.ts` (the legacy kit is not
exported there either).

- **`WzLegacySelect` `size="compact"`** (new, optional) — Finance Reporting's
  26px `span.select.compact`: value 13px/500 #666 at 4px 8px, a 36px chevron
  box (13×7 chevron), the list 11px under it with
  `0 3px 6px rgba(0,0,0,.18), 0 4px 15px rgba(0,0,0,.15)`, the chosen row
  #ededed. **`disabled`** (new, optional) — keeps the look, never opens
  (External Company while an Ad Group is chosen). Defaults unchanged.
- **`WzLegacyGrid`** (`legacy-grid.tsx`) `columns={id,label,sortable}` `rows`
  `totals` `sort` `onSort` `pageSize` `pageSizes` `onPageSize` `search`
  `onSearch` `onRefresh` `info` `onPrevious` `onNext` `busy` — the server-side
  DataTables grid: the #f7f7f7 band ("Show [50▾] entries", the round "Reload
  Results" button, the 200×32 "search" box), names 14px/500 capitalised and
  never wrapped (the grid scrolls sideways), **the Totals row inside the
  head**, 11px/12px rows at 9px 5px, #f0f0f0 hover, #f1f1f1 sorted column,
  "No Records Found", and the info line with ◂◂ Previous | Next ▸▸.
  (`WzDataTable` stays Job Statistics' client-side grid: 13px rows, Totals in
  the foot.)
- **`WzLegacyFieldsPanel`** (`legacy-fields-panel.tsx`) `fields={id,label,on}`
  `onToggle` `onClose` — the grey (#e3e5ea) "Fields" box: 165×28 tiles of
  "Name:" + Developr's 35×15 "switch tiny" (#eac300 on), seven to a row, ✕.
- **`WzLegacyPillButton`** `pressed` and **`WzLegacySummary`** `title`
  `columns` `rows` (`legacy-report-parts.tsx`) — the yellow #ffd400 32px pill
  (#eac300 hovered or pressed) and the titled summary table under a legacy
  report (h3 20px #3e4b51 over a #ddd rule, 14px/500 names, 11px rows).

## Call Tracking pieces (2026-10-09, agent `rep_calltracking`)

Measured off `rep_calltracking_wz_*` (notes:
`workiz-data-parser/docs/import/app-parity-2026-10-08/rep_calltracking.md`).
Workiz's Call Tracking is a React page (not the legacy iframe) with a
Chart.js 2 graph. Import each from its file.

- **`WzAreaChart`** (`area-chart.tsx`) `labels` `series={label,values,color}[]`
  `aspectRatio=5` `legend` `aria-label` — Chart.js 2's filled `line` chart in
  SVG with Chart.js's own geometry (read off the live `Chart.instances`): the
  canvas as wide as its box and a fifth as tall; a linear y scale from the
  data's floor with nice steps (**`chartLinearTicks(min, max, maxTicks)`**,
  Chart.js's `generateTicks`), 12px Helvetica #666 labels 10px off the axis,
  rgba(0,0,0,.1) grid, the zero line .25, the axis line; a category x axis
  without grid lines whose labels tilt up to 50° and thin out
  (**`areaLayout`** — rotation, plot box, auto-skip); every line tension .4,
  1px, filled to zero at 20%, 3px rings; the fills under all lines and the
  first series on top, as Chart.js draws them. The pointer within a point's
  radius + hit radius (**`nearestPoint`**) raises that bucket's points to 4px
  at 40% and opens Chart.js's tooltip (black .8, r6, the bucket bold over
  "■ name: n", placed by its `determineAlignment`, with the caret). Under it
  Workiz's HTML legend (`ul._flowLegend`): 25.2px in, 10px over and under,
  items ≤150px with a 20px box of the 20% colour and the name under it — a
  hundred flows squeeze into stripes, as in Workiz. Colours are any CSS
  colour (tokens included; tints via `color-mix`). Each bucket's total is an
  sr-only table. Points are one `<path>` per series, so a year of days by a
  hundred flows stays light.
- **`WzFlowViews`** (`flow-views.tsx`) `options` `value` `onChange`
  `aria-label` — the graph step switch "hour | day | week | month"
  (`div._flowViews`): 272×28, 1px #ccc, 6px corners, equal 14px parts 5px
  from top and bottom, #ccc rules between, the chosen (and hovered) part
  #ddd. A radio group with arrow keys. (Not `WzButtonGroup` — the legacy
  pages' 32px #ececec one.)
- **`WzKpiCard size="cardsBar"`** (new, optional) — the report's
  `react_components_cardsBar` card: the figure 20px/25px, the caption 1.2em
  (16.8px/16px) 10px under it; the box is `._fCard`'s. Seven share a row as
  `flex-1 basis-0 min-w-[120px] max-w-[300px] mr-[15px]` (the last keeps its
  margin) inside `py-[5px]`.
- **`WzSelect geometry="bare"`** (new, optional) — a react-select with no
  floating label: the label stays for screen readers only and the value sits
  centred 16.32px down ("By Call Flow", 200×48.6).
- **`WzReportGrid emptyText={null}`** (new, optional) — an empty report with
  nothing printed over its ten blank rows (Call Tracking's `_noData`).
- `WzDateRangePicker` as Call Tracking draws it: `className="w-auto"` makes
  the box as wide as its words (228px for "This month / Oct 1st, 2026 - Oct
  9th, 2026"); Custom keeps its 362px.

## Document pages (2026-10-09, agent `pg_estimate`, the estimate page)

Measured off `pg_estimate_wz_*` (job estimate 6764834, client estimate
6067865; notes `workiz-data-parser/docs/import/app-parity-2026-10-08/pg_estimate.md`)
and main.css (`Button-module`, `MenuPopup-module`, `estimate-module`,
`signatures-module`, `totals-module`). The invoice page is built from the same
modules, so these are meant for it too. All new; nothing existing changed.

- **`WzButtonLink`** (`button.tsx`) `href` `variant` `size` `icon` — `WzButton`'s
  look on a Next `Link`, for the buttons that go somewhere ("Price book",
  "Create new job"): `size="regular"` is Workiz's 32px (34px outlined).
- **`WZ_MENU_POPUP`** / **`WZ_MENU_POPUP_ITEM`** (`menu-popup.ts`) — class
  strings for `DropdownMenuContent` / `DropdownMenuItem` that turn them into
  Workiz's small MenuPopup (the estimate's Actions / Send / Add estimate): as
  wide as its longest row, r8, 8px in, `0 0 4px rgba(59,75,82,.05), 0 8px 16px
  rgba(59,75,82,.15)`, 35px rows of 13px ink with a 24px glyph slot, #f3f6f7
  under the cursor, Delete left ink. Hang it `align="end" sideOffset={8}
  alignOffset={-4}`. (The job page's 216px slate menu stays the default.)
- **`WzDocSectionHead`** (`document-parts.tsx`) `title` `icon` `action` — a
  section head under a document's totals: glyph + 18px/22px 500 #3b4c53 title,
  the button at the right, a 1px #cad3d6 rule 6px under (Signatures,
  Attachments). Notes: `className="border-input pb-[15px]"`.
- **`WzTotalsBoxRow`** `label` `colon="spaced"|"tight"` `underline` `bold`
  `hint` `onClick` `title` — "Subtotal :" + the 132×28 grey box
  (**`WZ_TOTALS_BOX`**: #f7f7f7, 1px #ccc, r2, 14px #666, normal tracking);
  `onClick` makes the box a button ("Deposit :", the Discount box). Stack them
  with `flex flex-col items-end gap-[5px]` (33px apart).

Shared billing components grew a Workiz variant on the same props (default
unchanged): `DocumentItemsTable variant="workiz"`, `DocumentSummaryPanel
variant="workiz"`, `SignaturesSection variant="workiz"` (features/billing).

## Hub cards (2026-10-09, agent `rep_hub`, the Reports hub)

Measured off `rep_hub_wz_*` (`/root/_reports?view=workiz-reports`; notes:
`workiz-data-parser/docs/import/app-parity-2026-10-08/rep_hub.md`). Import
from `@/components/workiz/hub-cards`.

- **`WzHubGrid`** `aria-label` — Developr's `.columns.with-padding` as a list:
  pulled 2.25% left, 20px in all round, the last row's margin taken back.
- **`WzHubCard`** `href` `title` `icon` (a `LucideIcon`) — one
  `.c_hover` column holding a `.card.widget.left-green` link: 3px ink rule on
  the left, 1px corners, 15px in (46px tall), shadow
  `0 1px 3px rgba(0,0,0,.16), 0 2px 10px rgba(0,0,0,.12)`; the title
  16px/16px 500 ink; the glyph #404040 where Workiz's 30px Linearicons box
  sits (10px down, 20px in from the right) — drawn 34px with a 1.35 stroke so
  Lucide's ink (20/24 of its box) is as big and as heavy as Workiz's.
  Columns: one to a row (97.75%) under 768px, two (47.75%) to 1199px, three
  (31.0833%) from 1200px, 20px apart (25px from 1200px) — Workiz's media
  queries on the window, as `min-[768px]` / `min-[1200px]` (not `md:`, which
  Tailwind would sort after the arbitrary 1200px). Hover = `.c_hover`'s
  `0 12px 12px -8px rgba(0,0,0,.4)` under the column (.3s); ours also on
  keyboard focus (Workiz shows no focus at all).
- **`WzHubCardSkeleton`** — the same column and card with a grey bar.

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
