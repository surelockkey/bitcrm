/**
 * The BitCRM colour tokens, in one place.
 *
 * Every value is sampled from Workiz's own screenshots
 * (workiz-data-parser/data/ui_reference) rather than eyeballed, because the
 * people using this product are moving off Workiz and should not have to
 * relearn what a screen looks like.
 *
 * Light only, on purpose. Workiz has no dark theme to copy, so a dark one
 * would be invention rather than parity, and it is deliberately left out of
 * this pass — see the note in app/providers.tsx.
 *
 * This module is the source of truth; app/globals.css is generated from it,
 * and app/globals.test.ts fails if the two drift.
 */

export type TokenName = keyof typeof LIGHT;

export const LIGHT = {
  // Surfaces. The content section is white — the grey is not a canvas, it is
  // a separator: the strips above the content, the table header and the zebra
  // row. Painting the whole page grey is the mistake that makes a Workiz
  // clone look like something else.
  background: "#ffffff",
  foreground: "#3b4b52",
  card: "#ffffff",
  cardForeground: "#3b4b52",
  popover: "#ffffff",
  popoverForeground: "#3b4b52",
  muted: "#f7f7f7",
  mutedForeground: "#5e5e5e",

  // The yellow, and only on the one action per screen that Workiz spends it
  // on ("+ Create New"). It is a fill, never a text colour — 1.45:1 on white.
  primary: "#fad400",
  primaryForeground: "#3b4b52",

  // Everything else interactive is their blue: links, checkboxes, switches,
  // selected states, the focus ring. `brand` was the yellow for one commit and
  // it turned the whole chat yellow at once.
  brand: "#3589e9",
  brandForeground: "#ffffff",
  secondary: "#3589e9",
  secondaryForeground: "#ffffff",

  // The row tint Workiz uses for selection and hover.
  accent: "#e5f1ff",
  accentForeground: "#3b4b52",

  // Status fills.
  destructive: "#be2c2c",
  destructiveForeground: "#ffffff",
  success: "#198218",
  successForeground: "#ffffff",
  warning: "#ffa500",
  warningForeground: "#3b4b52",
  info: "#3589e9",
  infoForeground: "#ffffff",

  // Text for the tinted status pills. The fills above cannot carry their own
  // label — Workiz orange is 1.98:1 on white — so each tone gets the same hue
  // pushed dark enough to read. Only lib/theme/tone.ts uses these.
  neutral: "#64748b",
  neutralText: "#48555c",
  infoText: "#1b5fae",
  successText: "#136b12",
  warningText: "#8a5a00",
  destructiveText: "#a02525",

  // Chart series, by the state they stand for. Workiz's own "Jobs By Status"
  // bars sample as #e29483 / #fbf1a3 / #afdbb5, and those three fail on their
  // own terms: yellow against green measures ΔE 12.2 for *normal* vision,
  // under the 15 needed to tell two bars in one group apart. These are the
  // same three hue families stepped until they pass — deeper, not different.
  // Canceled → critical, Open → warning, Done → good.
  chartCritical: "#c8563f",
  chartWarning: "#cf9a1f",
  chartGood: "#45996b",

  // Lines. Deliberately fainter than the 3:1 non-text guideline — Workiz grid
  // rules are this light, and darkening them reads as a different product.
  border: "#dfe2e3",
  input: "#cccccc",
  ring: "#3589e9",
  // The grid rules are their own, darker line: #cfcfcf between every column
  // of the jobs table. The chrome border disappears at that density.
  tableBorder: "#cfcfcf",

  // Chrome. Their top bar is 56px with a one-pixel rule under it.
  topbar: "#f3f6f7",
  topbarForeground: "#3b4b52",
  topbarBorder: "#dfe2e3",
  sidebar: "#ffffff",
  sidebarForeground: "#3b4b52",
  sidebarAccent: "#f3f6f7",
  sidebarAccentForeground: "#3b4b52",
  sidebarBorder: "#dfe2e3",
  sidebarRing: "#3589e9",
  // A chart's second series, beside `brand` as the first. Not sampled from
  // Workiz (its charts are Google's defaults): the dataviz reference orange,
  // validated against brand for CVD and normal-vision separation.
  chart2: "#eb6834",
  // Slots 3-8 for charts with more series than two — the pies' four slices,
  // "Top Call Flows"' eight lines. The dataviz reference order after brand and
  // chart2, validated as a set: adjacent CVD ΔE ≥ 9.1, normal-vision ≥ 19.6.
  // Aqua, yellow and magenta sit under 3:1 on white, so every chart that uses
  // them names its series in a visible legend.
  chart3: "#1baf7a",
  chart4: "#eda100",
  chart5: "#e87ba4",
  chart6: "#008300",
  chart7: "#4a3aa7",
  chart8: "#e34948",

  // The Workiz form kit (components/workiz). Every value is a computed style
  // or a rule read off app.workiz.com — the captures and the stylesheet dump
  // under workiz-data-parser/data/ui_reference/jobs_parity_2026-10-08 — so
  // the New Job form and the job page's Details tab match field for field.
  // Text field: the floating label, the typed value, the yellow focus edge
  // (#ffd400 — a hair brighter than the button yellow), new_01_empty and
  // formkit_focus_empty.
  wzLabel: "#8c8c8c",
  wzText: "#666666",
  wzFocus: "#ffd400",
  // Select (react-select): placeholder, value, hover edge, option text and
  // the focused / chosen option fills, new_02_job_type_open and
  // formkit_country_open. The placeholder grey is also the textarea's.
  wzPlaceholder: "#808080",
  wzValue: "#333333",
  wzFieldHover: "#b3b3b3",
  wzStrong: "#404040",
  wzOptionFocus: "#deebff",
  wzOptionSelected: "#2684ff",
  // The time list's focused row (formkit_time_hover2) — their information_100.
  wzOptionSoft: "#c2deff",
  // A disabled control, as react-select draws one.
  wzDisabled: "#f2f2f2",
  wzDisabledBorder: "#e6e6e6",
  // The newer outlined fields (Starts / Ends / At) and the upload tiles: the
  // edge, the resting label, the disabled grey, and the blue the edge turns
  // while focused — the same blue as their links ("Set recurring schedule").
  wzOutline: "#9ea6aa",
  wzOutlineLabel: "#768287",
  wzOutlineDisabled: "#bfc4c7",
  wzLink: "#6aa8ee",
  // Messages: "Please select a service area…", "Required field".
  wzError: "#e35a36",
  // The Scheduled toggle, on and off.
  wzSwitchOn: "#50d58c",
  wzSwitchOff: "#bbbbbb",
  // The job page's section rule under "Client", "Schedule", "Job"…
  wzRule: "#cad3d6",
  // Upload tile fill, and the "You can choose up to 5 files" caption.
  wzTile: "#f7f8f8",
  wzCaption: "#999999",
  // Button states: the yellow pill hovered / pressed, the outline pill
  // hovered / pressed (formkit_create_hover, formkit_viewschedule_hover).
  wzPrimaryHover: "#eac300",
  wzPrimaryActive: "#dcb802",
  wzSecondaryHover: "#f3f6f7",
  wzSecondaryActive: "#c8ced0",

  // The app-wide kit (components/ui restyled to Workiz, components/workiz
  // shared pieces). Read off Workiz's Button-module / IconButton-module /
  // niceBox / redux-toastr rules and the uikit_wz_* captures.
  // The red "danger" pill (Button-module danger) — also Workiz's counter
  // badges and the overdue red — hovered / pressed.
  wzDanger: "#f45e44",
  wzDangerHover: "#d42a0c",
  wzDangerActive: "#ae230a",
  // The blue "accent" pill ("Upgrade plan") hovered.
  wzAccentHover: "#1874dc",
  // A disabled pill: pale fill, grey words (the login's "Verify").
  wzDisabledFill: "#eff1f1",
  // Slate text: Actions-menu rows, idle small tabs (Tabs-module).
  wzSlate: "#566d76",
  // The bar under the open tab, and KPI card titles.
  wzTabBar: "#3e4b51",
  // The rule under a row of small tabs.
  wzTabRule: "#c4c4c4",
  // The grid's frame, the list toolbar's top rule, section rules.
  wzFrame: "#dddddd",
  // The browser checkbox's edge (Workiz forms use the native box).
  wzNativeCheck: "#767676",
  // The pager's round ‹ › discs, resting / hovered.
  wzDisc: "#fafafa",
  wzDiscHover: "#ededed",
  // The page-explain band behind "Job Types — Add your job types…".
  wzBand: "#fafcfc",
  // A drawer's close ×.
  wzCloseIcon: "#607890",
  // Toasts (redux-toastr): success, warning, info; errors are wzDanger.
  wzToastSuccess: "#83c795",
  wzToastWarning: "#f7a336",
  wzToastInfo: "#58abc3",
} as const satisfies Record<string, string>;

/** Pairs that carry running text: WCAG AA, 4.5:1. */
export const BODY_TEXT_PAIRS: ReadonlyArray<[TokenName, TokenName]> = [
  ["foreground", "background"],
  ["foreground", "card"],
  ["cardForeground", "card"],
  ["popoverForeground", "popover"],
  ["mutedForeground", "card"],
  ["mutedForeground", "background"],
  ["mutedForeground", "muted"],
  ["accentForeground", "accent"],
  ["sidebarForeground", "sidebar"],
  ["sidebarAccentForeground", "sidebarAccent"],
  ["topbarForeground", "topbar"],
  ["neutralText", "card"],
  ["neutralText", "background"],
  ["infoText", "card"],
  ["infoText", "background"],
  ["successText", "card"],
  ["successText", "background"],
  ["warningText", "card"],
  ["warningText", "background"],
  ["destructiveText", "card"],
  ["destructiveText", "background"],
  // The chat's quick-reply chips: deep blue label on the pale blue row tint.
  ["infoText", "accent"],
];

/** Button labels and focus rings: 3:1 is the bar for large and non-text. */
export const UI_TEXT_PAIRS: ReadonlyArray<[TokenName, TokenName]> = [
  ["primaryForeground", "primary"],
  ["brandForeground", "brand"],
  ["secondaryForeground", "secondary"],
  ["destructiveForeground", "destructive"],
  ["successForeground", "success"],
  ["warningForeground", "warning"],
  ["infoForeground", "info"],
  ["ring", "card"],
  ["ring", "background"],
];
