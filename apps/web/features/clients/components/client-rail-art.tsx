/**
 * The pictures over the rail panels' empty states (pg_contact_wz_278039_rail_*):
 * a 110px pale disc with a spiral notepad and a yellow pencil (Notes), or an
 * open folder with papers (Files). Drawn here so nothing is fetched.
 */

const DISC = "#eef1f2";
const INK = "#3b4b52";
const YELLOW = "#fad400";

export function EmptyNotesArt() {
  return (
    <svg width="110" height="110" viewBox="0 0 110 110" aria-hidden className="shrink-0">
      <circle cx="55" cy="55" r="55" fill={DISC} />
      <rect x="22" y="26" width="52" height="54" rx="3" fill="#fff" stroke={INK} strokeWidth="2" />
      {[34, 46, 58].map((x) => (
        <rect key={x} x={x} y="20" width="5" height="13" rx="2.5" fill="#fff" stroke={INK} strokeWidth="2" />
      ))}
      <path d="M44 86 L86 44 L94 52 L52 94 L42 96 Z" fill={YELLOW} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
      <path d="M80 50 L88 58" stroke={INK} strokeWidth="2" />
      <ellipse cx="44" cy="99" rx="16" ry="2.5" fill="#dfe2e3" />
    </svg>
  );
}

export function EmptyFilesArt() {
  return (
    <svg width="110" height="110" viewBox="0 0 110 110" aria-hidden className="shrink-0">
      <circle cx="55" cy="55" r="55" fill={DISC} />
      <path d="M40 14 L88 20 L84 66 L36 60 Z" fill={YELLOW} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
      <rect x="34" y="20" width="46" height="50" rx="2" fill="#fff" stroke={INK} strokeWidth="2" />
      <rect x="40" y="27" width="34" height="8" fill="#c2deff" stroke={INK} strokeWidth="1.5" />
      {[42, 50, 58].map((y) => (
        <path key={y} d={`M42 ${y} H72`} stroke={INK} strokeWidth="1.5" />
      ))}
      <path d="M24 50 H46 L50 56 H86 V92 Q86 96 82 96 H28 Q24 96 24 92 Z" fill="#fff" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
