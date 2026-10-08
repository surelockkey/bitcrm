/**
 * Empty-state pictures for the job page's tabs, drawn for BitCRM in the
 * manner of Workiz's (a pale disc, ink line art, one yellow or green accent)
 * and at their measured sizes: Items ≈160px, Payments ≈115px, Estimates
 * 160px, Upload 120px. Our own drawings, not Workiz's artwork.
 */

const INK = "#3b4b52";
const YELLOW = "#fad400";
const GREEN = "#3acf7d";

export function ItemsArt() {
  return (
    <svg aria-hidden width="160" height="144" viewBox="0 0 160 144" fill="none">
      <ellipse cx="80" cy="72" rx="78" ry="70" fill="#f3f6f7" />
      <rect x="28" y="38" width="88" height="62" rx="3" fill="#fff" stroke={INK} strokeWidth="1.5" />
      <rect x="28" y="38" width="88" height="10" fill={YELLOW} stroke={INK} strokeWidth="1.5" />
      <path d="M40 60h40M40 70h52M40 80h30M40 90h44" stroke={INK} strokeWidth="1.2" strokeLinecap="round" />
      <rect x="66" y="58" width="68" height="50" rx="3" fill="#fff" stroke={INK} strokeWidth="1.5" />
      <path d="M74 70h22M74 80h40M74 90h30" stroke={INK} strokeWidth="1.2" strokeLinecap="round" />
      <rect x="104" y="64" width="22" height="8" rx="1.5" fill={YELLOW} />
      <path d="M26 108h112" stroke={INK} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function PaymentsArt() {
  return (
    <svg aria-hidden width="120" height="116" viewBox="0 0 120 116" fill="none">
      <circle cx="60" cy="58" r="57" fill="#f3f6f7" />
      <g transform="rotate(-28 60 50)">
        <rect x="32" y="36" width="56" height="30" rx="3" fill={GREEN} stroke={INK} strokeWidth="1.5" />
        <rect x="38" y="42" width="44" height="18" rx="2" fill="none" stroke={INK} strokeWidth="1.2" />
        <circle cx="60" cy="51" r="5" fill={YELLOW} stroke={INK} strokeWidth="1.2" />
      </g>
      <path d="M8 86h22l12-6c4-2 9-1 12 2l2 2H40" stroke={INK} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 98h26l30-10c4-1 6-6 2-8" stroke={INK} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M86 22l20-12M92 30l18-4" stroke={INK} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function EstimatesArt() {
  return (
    <svg aria-hidden width="160" height="160" viewBox="0 0 160 160" fill="none">
      <circle cx="80" cy="80" r="80" fill="#e8e8e8" />
      <rect x="34" y="22" width="70" height="96" rx="3" fill="#fff" stroke={INK} strokeWidth="1.5" transform="rotate(-6 69 70)" />
      <rect x="40" y="30" width="16" height="16" fill={GREEN} stroke={INK} strokeWidth="1.2" />
      <rect x="62" y="30" width="16" height="16" fill="#cad3d6" stroke={INK} strokeWidth="1.2" />
      <rect x="84" y="30" width="16" height="16" fill={YELLOW} stroke={INK} strokeWidth="1.2" />
      <text x="42" y="74" fontSize="20" fill={INK} fontFamily="Poppins, sans-serif">$</text>
      <text x="42" y="104" fontSize="20" fill={INK} fontFamily="Poppins, sans-serif">$</text>
      <path d="M58 66h28M58 96h20" stroke={INK} strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="98" cy="96" r="20" fill="#fff" stroke={INK} strokeWidth="5" />
      <path d="M112 112l18 18" stroke={YELLOW} strokeWidth="8" strokeLinecap="round" />
      <path d="M112 112l18 18" stroke={INK} strokeWidth="1.5" strokeLinecap="round" />
      <ellipse cx="96" cy="146" rx="22" ry="3" fill="#cad3d6" />
    </svg>
  );
}

export function UploadArt() {
  return (
    <svg aria-hidden width="120" height="120" viewBox="0 0 120 120" fill="none">
      <circle cx="60" cy="60" r="60" fill="#f3f6f7" />
      <path
        d="M34 66c-8 0-13-6-13-13 0-7 6-13 13-13 1-10 9-17 19-17 8 0 14 5 17 11 2-1 4-1 6-1 9 0 16 7 16 16 7 1 11 6 11 12 0 7-5 12-12 12H34z"
        fill="#fff"
        stroke={INK}
        strokeWidth="1.5"
      />
      <rect x="40" y="44" width="34" height="7" rx="3.5" fill="#cad3d6" />
      <rect x="40" y="44" width="20" height="7" rx="3.5" fill="#6aa8ee" />
      <path d="M60 98V62M48 74l12-12 12 12" stroke={INK} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M60 98V62M48 74l12-12 12 12" stroke={YELLOW} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <ellipse cx="60" cy="106" rx="10" ry="2" fill="#cad3d6" />
    </svg>
  );
}
