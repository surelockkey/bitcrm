/**
 * The Workiz form kit: pixel-matched controls for the New Job page and the
 * job page's Details tab. See README.md in this folder.
 */
export { WzTextField, type WzTextFieldProps } from "./text-field";
export { WzFieldGroup, type WzJoin } from "./field-group";
export { WzTextarea, type WzTextareaProps } from "./textarea";
export {
  WzSelect,
  WzMultiSelect,
  containsFilter,
  type WzSelectProps,
  type WzMultiSelectProps,
  type WzOption,
  type WzFilter,
} from "./select";
export {
  WzTimeSelect,
  WzDateField,
  formatWzTime,
  formatWzDate,
  parseWzDate,
  wzTimeSlots,
  type WzTimeSelectProps,
  type WzDateFieldProps,
} from "./outlined";
export { WzOutlinedSelect, type WzOutlinedSelectProps } from "./outlined-select";
export { WzCalendar, type WzCalendarProps } from "./calendar";
export { WzCalendarOutlineIcon } from "./icons";
export { WzSwitch, WzCheckbox, type WzSwitchProps, type WzCheckboxProps } from "./toggles";
export { WzButton, WzLink, type WzButtonProps } from "./button";
export { WzCard, WzSectionHeader, WzActionBar, type WzCardProps, type WzSectionHeaderProps } from "./layout";
export { WzUploadField, type WzUploadFieldProps, type WzUploadedFile } from "./upload";
export { WzFieldError, WzNotice } from "./messages";
export { WzSuggestionList, WzSuggestion, splitMatch, type WzSuggestionProps } from "./suggestions";

// The app-wide kit: list chrome, menus, drawers, tabs, the rail.
export { WzPager, wzPagerSummary, wzPagerPages, type WzPagerState } from "./pager";
export { WzListToolbar, WzSearchBox, WzPageSizeSelect, WzToolbarButton } from "./toolbar";
export { WzDrawer, WzDrawerSection } from "./drawer";
export { WzActionsMenu, type WzMenuAction } from "./menu";
export { WzTabBar, type WzTab } from "./tab-bar";
export { wzPill, type WzPillTone, type WzPillSize } from "./pill";
export { WzTableEmpty } from "./table-empty";
export { WzFilterChip } from "./filter-chip";
export { WzRail, WzRailButton, WzRailPanel } from "./rail";

// Section pages (Workiz Phone, callspage_wz_*): heading + pill, link tabs,
// stat cards, the counted icon button, the date box, "+ Add filter".
export { WzPageHeader, WzHeaderPill, WzTabLinks, WzStatCard, WzBadgeIconButton } from "./page-parts";
export { WzDateRangePicker, type WzDateRange, type WzDateRangePickerProps } from "./date-range-picker";
export { WzAddFilter, WzFilterField, WzFilterOptions } from "./filter-bar";
export { formatWzDay, formatWzDayRange, formatUsDay, parseUsDay, ordinal } from "./dates";

// List-page pieces (Clients list).
// KPI card with the coloured left rule (`._fCard`, Clients list) — not the Phone page's `WzStatCard`.
export { WzKpiCard, WzKpiCardSkeleton, type WzKpiTone } from "./kpi-card";
export {
  WzFilterSelect,
  filterSelectGroups,
  type WzFilterGroup,
  type WzFilterOption,
  type WzFilterPick,
} from "./filter-select";
export { WzFieldsPanel, fieldsPanelLists, toggleField, moveField, type WzFieldOption } from "./fields-panel";
export { WzTableNoData } from "./no-data";

// Workiz Home: the widget frame, its range picker and figures, and the charts.
export {
  WzWidget,
  WzRangeSelect,
  WzWidgetStat,
  WzChartLegend,
  type WzWidgetMenuItem,
  type WzRangeOption,
} from "./widget";
export { WzWidgetBarChart, WzWidgetLineChart, WzWidgetPie, WZ_PIE_COLORS, type WzSeries, type WzPieSliceData } from "./widget-charts";
export {
  wzChartTicks,
  wzAxisLabels,
  wzDayLabel,
  wzSlashDay,
  wzPieSlices,
  wzSpline,
  type WzPoint,
  type WzPieSlice,
} from "./chart-scale";

// Report grid (Activity report).
export { WzReportGrid, wzNextSort, type WzReportColumn, type WzSortDir } from "./report-grid";

// Record-page pieces (Workiz's client page, pg_contact_wz_*).
export {
  WzLocalGrid,
  localGridView,
  nextGridSort,
  WZ_GRID_PAGE_SIZES,
  type WzGridColumn,
  type WzGridSort,
  type WzGridView,
} from "./local-grid";
export { WzTotalsBar, WzLeftBorderBox, WzFold, WzSegmented } from "./record-parts";
// Document-page pieces (Workiz's estimate page, pg_estimate_wz_*).
export { WzButtonLink } from "./button";
export { WZ_MENU_POPUP, WZ_MENU_POPUP_ITEM } from "./menu-popup";
export { WzDocSectionHead, WzTotalsBoxRow, WZ_TOTALS_BOX } from "./document-parts";
