import type { SVGProps } from "react";

/*
 * The exact glyphs Workiz draws, so the controls match to the pixel:
 * react-select's own chevron and cross (Workiz ships react-select v3), MUI's
 * calendar / arrow icons for the date picker, and the thin chevron of their
 * newer time field (pixel-traced from new_01_empty: 10×6, 1.5px, ink).
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

/** react-select `DownChevron` (20×20 viewBox). */
export function RsChevronIcon({ size = 20, ...props }: IconProps) {
  return (
    <svg height={size} width={size} viewBox="0 0 20 20" aria-hidden focusable="false" fill="currentColor" {...props}>
      <path d="M4.516 7.548c0.436-0.446 1.043-0.481 1.576 0l3.908 3.747 3.908-3.747c0.533-0.481 1.141-0.446 1.574 0 0.436 0.445 0.408 1.197 0 1.615-0.406 0.418-4.695 4.502-4.695 4.502-0.217 0.223-0.502 0.335-0.787 0.335s-0.57-0.112-0.789-0.335c0 0-4.287-4.084-4.695-4.502s-0.436-1.17 0-1.615z" />
    </svg>
  );
}

/** react-select `CrossIcon` (20×20 viewBox): the clear × and the chip ×. */
export function RsCrossIcon({ size = 20, ...props }: IconProps) {
  return (
    <svg height={size} width={size} viewBox="0 0 20 20" aria-hidden focusable="false" fill="currentColor" {...props}>
      <path d="M14.348 14.849c-0.469 0.469-1.229 0.469-1.697 0l-2.651-3.030-2.651 3.029c-0.469 0.469-1.229 0.469-1.697 0-0.469-0.469-0.469-1.229 0-1.697l2.758-3.15-2.759-3.152c-0.469-0.469-0.469-1.228 0-1.697s1.228-0.469 1.697 0l2.652 3.031 2.651-3.031c0.469-0.469 1.228-0.469 1.697 0s0.469 1.229 0 1.697l-2.758 3.152 2.758 3.15c0.469 0.469 0.469 1.229 0 1.698z" />
    </svg>
  );
}

/** The time field's thin chevron: 10×6, pointing down (or up while open). */
export function ThinChevronIcon({ up = false, ...props }: SVGProps<SVGSVGElement> & { up?: boolean }) {
  return (
    <svg width="12" height="8" viewBox="0 0 12 8" aria-hidden focusable="false" fill="none" {...props}>
      <path
        d={up ? "M1 7 6 1.25 11 7" : "M1 1l5 5.75L11 1"}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The outline calendar on "View schedule" (their Linearicons glyph, traced
 * from new_01_empty: a 14px box, a rule under the top, two rings).
 */
export function WzCalendarOutlineIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden focusable="false" fill="none" {...props}>
      <rect x="1.5" y="2.6" width="13" height="12" rx="0.6" stroke="currentColor" strokeWidth="1.2" />
      <path d="M1.5 6.6h13M5 1v3.2M11 1v3.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/** MUI `CalendarIcon` (24×24), as on the Starts / Ends fields. */
export function MuiCalendarIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden focusable="false" fill="currentColor" {...props}>
      <path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z" />
    </svg>
  );
}

/** MUI `ArrowDropDown` (the month header's view switch). */
export function MuiArrowDropDownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden focusable="false" fill="currentColor" {...props}>
      <path d="M7 10l5 5 5-5z" />
    </svg>
  );
}

/** MUI `ArrowLeft` / `ArrowRight` (the month header's previous / next). */
export function MuiArrowLeftIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden focusable="false" fill="currentColor" {...props}>
      <path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z" />
    </svg>
  );
}

export function MuiArrowRightIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden focusable="false" fill="currentColor" {...props}>
      <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" />
    </svg>
  );
}

/**
 * Workiz's row "Edit" glyph (`_assets/svg/edit.svg`, 20×20): a pencil over a
 * base line, 1.5px strokes in `currentColor` (ink #3b4b52 in Workiz's
 * price-book grids).
 */
export function WzEditIcon({ size = 20, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden focusable="false" {...props}>
      <path d="M1 19H16.224" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M9.30434 14.156L5.15234 14.9034L5.84434 10.696L15.1586 1.40938C15.2873 1.27966 15.4404 1.1767 15.609 1.10644C15.7777 1.03618 15.9586 1 16.1413 1C16.324 1 16.5049 1.03618 16.6735 1.10644C16.8422 1.1767 16.9953 1.27966 17.1239 1.40938L18.591 2.87642C18.7207 3.00508 18.8236 3.15815 18.8939 3.32681C18.9642 3.49546 19.0003 3.67636 19.0003 3.85906C19.0003 4.04176 18.9642 4.22266 18.8939 4.39131C18.8236 4.55997 18.7207 4.71304 18.591 4.8417L9.30434 14.156Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Workiz's row "Delete" glyph (`_assets/svg/delete-red.svg`, 22×21): a bin,
 * 1.5px strokes in `currentColor` (#f45e44 in Workiz; #bfc4c7 when it
 * cannot delete).
 */
export function WzTrashIcon({ size = 21, ...props }: IconProps) {
  return (
    <svg width={(size * 22) / 21} height={size} viewBox="0 0 22 21" fill="none" aria-hidden focusable="false" {...props}>
      <path
        d="M16.3844 19.4615H5.61512C5.2071 19.4615 4.81578 19.2994 4.52726 19.0109C4.23875 18.7224 4.07666 18.3311 4.07666 17.9231V4.0769H17.9228V17.9231C17.9228 18.3311 17.7607 18.7224 17.4722 19.0109C17.1837 19.2994 16.7924 19.4615 16.3844 19.4615Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M8.69189 14.8462V8.69238" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.3081 14.8462V8.69238" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M1 4.0769H21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M13.3077 1H8.69227C8.28424 1 7.89293 1.16209 7.60441 1.45061C7.3159 1.73912 7.15381 2.13044 7.15381 2.53846V4.07692H14.8461V2.53846C14.8461 2.13044 14.684 1.73912 14.3955 1.45061C14.107 1.16209 13.7157 1 13.3077 1Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Workiz's stroke glyphs are 1.5px round-capped lines in `currentColor` (ink #3b4b52). */
const STROKE = {
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/**
 * Workiz's "Stock" glyph (`_assets/svg/inventory_new.svg`, 25×24): an open
 * box — the Inventory grid's and Locations' row button that opens Manage stock.
 */
export function WzStockIcon({ size = 24, ...props }: IconProps) {
  return (
    <svg width={(size * 25) / 24} height={size} viewBox="0 0 25 24" fill="none" aria-hidden focusable="false" {...props}>
      <path d="M12.625 3L3.5 6.65L12.625 10.3L21.75 6.65L12.625 3Z" {...STROKE} />
      <path d="M3.5 6.65002V17.6L12.625 21.25V10.3L3.5 6.65002Z" {...STROKE} />
      <path d="M21.75 6.65002V17.6L12.625 21.25V10.3L21.75 6.65002Z" {...STROKE} />
      <path d="M17.6433 8.29252L8.51831 4.64252" {...STROKE} />
      <path d="M19.6209 15.775L18.1001 16.3834" {...STROKE} />
    </svg>
  );
}

/** Workiz's "Add items" glyph in Manage stock (`plus_bigger.svg`, 25×24). */
export function WzPlusBiggerIcon({ size = 24, ...props }: IconProps) {
  return (
    <svg width={(size * 25) / 24} height={size} viewBox="0 0 25 24" fill="none" aria-hidden focusable="false" {...props}>
      <path d="M12.5 5V19" {...STROKE} />
      <path d="M5.5 11.9569H19.5" {...STROKE} />
    </svg>
  );
}

/** Workiz's "Move items" glyph in Manage stock (`move_item.svg`, 25×24): a box with an arrow out. */
export function WzMoveItemIcon({ size = 24, ...props }: IconProps) {
  return (
    <svg width={(size * 25) / 24} height={size} viewBox="0 0 25 24" fill="none" aria-hidden focusable="false" {...props}>
      <path d="M11.4998 3L2.5 6.59993L11.4998 10.1999L20.4997 6.59993L11.4998 3Z" {...STROKE} />
      <path d="M2.5 6.59924V17.399L11.4998 20.999V10.1992L2.5 6.59924Z" {...STROKE} />
      <path d="M13.8684 20.0517L11.5005 20.9991V10.1993L20.5003 6.59937V9.15735" {...STROKE} />
      <path d="M16.45 8.22017L7.4502 4.62024" {...STROKE} />
      <path d="M20.6382 11.9951L22.4953 13.8523L20.6382 15.7094" {...STROKE} />
      <path
        d="M22.4956 13.8521H20.6385C19.4071 13.8521 18.2262 14.3412 17.3555 15.2119C16.4847 16.0826 15.9956 17.2636 15.9956 18.4949"
        {...STROKE}
      />
    </svg>
  );
}

/** Workiz's "Return items" glyph in Manage stock (`refresh.svg`, 24×24): a turning-back arrow. */
export function WzReturnIcon({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden focusable="false" {...props}>
      <path
        d="M13.0917 19.8167C14.6558 19.8167 16.1848 19.3529 17.4853 18.4839C18.7858 17.6149 19.7994 16.3797 20.398 14.9348C20.9966 13.4897 21.1532 11.8996 20.848 10.3655C20.5429 8.83143 19.7897 7.42231 18.6837 6.3163C17.5777 5.2103 16.1686 4.4571 14.6345 4.15196C13.1004 3.84681 11.5103 4.00342 10.0652 4.60199C8.62025 5.20055 7.38509 6.21419 6.51615 7.5147C5.64712 8.81522 5.18333 10.3442 5.18333 11.9083V12.5167"
        {...STROKE}
      />
      <path d="M2.75003 10.0809L5.18337 12.5143L7.6167 10.0809" {...STROKE} />
    </svg>
  );
}
