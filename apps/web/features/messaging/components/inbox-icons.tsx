import type { SVGProps } from "react";

/*
 * The Workiz inbox's own glyphs. The SVG ones are Workiz's public assets
 * (assets.workiz.com/latest/_assets/svg/…, named on each), redrawn inline with
 * the ink stroke as `currentColor`; Workiz shows them in 40px IconButtons at
 * 24×24 (`.IconButton-module__large img`). The font glyphs (wfi-message,
 * wfi-Native-avatar, wfi-Phone, workizIcon-forward-msg / -copy, lnr-paperclip,
 * wfi-ellipsis-kebab-menu) are traced from pg_messages_wz_07_thread_client:
 * 24px box, 1.5px ink line.
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

/** The categories column's fold button (`messages/categories_menu.svg`). */
export function WzCategoriesMenuIcon({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden focusable="false" {...props}>
      <path d="M4.6 3H19.4C19.4 3 21 3 21 4.6V19.4C21 19.4 21 21 19.4 21H4.6C4.6 21 3 21 3 19.4V4.6C3 4.6 3 3 4.6 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
      <path d="M8.5 3.5V21" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  );
}

/** Folded category: All (`messages/all.svg`). */
export function WzAllIcon({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden focusable="false" {...props}>
      <path d="M17.8 0.996094H2.2C1.53726 0.996094 1 1.53335 1 2.19609V6.99609C1 7.65883 1.53726 8.19609 2.2 8.19609H17.8C18.4627 8.19609 19 7.65883 19 6.99609V2.19609C19 1.53335 18.4627 0.996094 17.8 0.996094Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M17.8 11.7961H2.2C1.53726 11.7961 1 12.3333 1 12.9961V17.7961C1 18.4588 1.53726 18.9961 2.2 18.9961H17.8C18.4627 18.9961 19 18.4588 19 17.7961V12.9961C19 12.3333 18.4627 11.7961 17.8 11.7961Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

/** Folded category: Requests (`messages/requests.svg`). */
export function WzRequestsIcon({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 19 20" fill="none" aria-hidden focusable="false" {...props}>
      <path d="M11.8281 14.2344V17.8437C11.8281 18.1628 11.7014 18.4689 11.4757 18.6945C11.2501 18.9201 10.9441 19.0469 10.625 19.0469H8.21875C7.89966 19.0469 7.59364 18.9201 7.36801 18.6945C7.14238 18.4689 7.01562 18.1628 7.01562 17.8437V14.2344" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M7.01562 16.6406H11.8281" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M9.42188 1V2.20312" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M1 9.42188H2.20312" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M2.80469 3.40625L3.68698 4.25646" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M17.8437 9.42188H16.6406" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M16.0395 3.40625L15.1572 4.25646" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M6.95093 14.2344H11.8918C12.7862 13.7913 13.5372 13.1044 14.058 12.2529C14.5789 11.4014 14.8484 10.42 14.8354 9.42187C14.8107 7.9937 14.2323 6.63094 13.2223 5.62092C12.2123 4.6109 10.8495 4.03255 9.42135 4.00781C7.99317 4.03255 6.63041 4.6109 5.62039 5.62092C4.61037 6.63094 4.03202 7.9937 4.00728 9.42187C3.99431 10.42 4.2638 11.4014 4.78464 12.2529C5.30549 13.1044 6.05646 13.7913 6.95093 14.2344Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

/** Folded category: Clients (`clients.svg`). */
export function WzClientsIcon({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden focusable="false" {...props}>
      <path d="M6.15381 6.62037C7.30086 6.62037 8.23072 5.6905 8.23072 4.54346C8.23072 3.39642 7.30086 2.46655 6.15381 2.46655C5.00677 2.46655 4.0769 3.39642 4.0769 4.54346C4.0769 5.6905 5.00677 6.62037 6.15381 6.62037Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M10.3076 13.5434H2V12.6204C2 11.5187 2.43763 10.4622 3.21662 9.68318C3.99562 8.90419 5.05216 8.46655 6.15382 8.46655C7.25548 8.46655 8.31201 8.90419 9.09101 9.68318C9.87 10.4622 10.3076 11.5187 10.3076 12.6204V13.5434Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M9.8457 2.46655C10.3965 2.46655 10.9248 2.68537 11.3143 3.07486C11.7038 3.46436 11.9226 3.99263 11.9226 4.54346C11.9226 5.09429 11.7038 5.62256 11.3143 6.01206C10.9248 6.40155 10.3965 6.62037 9.8457 6.62037" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M11.323 8.6416C12.1093 8.94072 12.7862 9.47155 13.2643 10.1638C13.7423 10.8561 13.9988 11.6772 13.9999 12.5185V13.5431H12.6153" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

/** Folded category: Team (`popMenu/manageTeam.svg`). */
export function WzTeamIcon({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden focusable="false" {...props}>
      <path d="M5.54164 18.8169C6.71755 18.8169 7.67081 17.8637 7.67081 16.6878C7.67081 15.5119 6.71755 14.5586 5.54164 14.5586C4.36574 14.5586 3.41248 15.5119 3.41248 16.6878C3.41248 17.8637 4.36574 18.8169 5.54164 18.8169Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M8.58333 21.2508C8.28931 20.6995 7.851 20.2385 7.31525 19.917C6.7795 19.5956 6.16645 19.4258 5.54167 19.4258C4.91688 19.4258 4.30384 19.5956 3.76809 19.917C3.23233 20.2385 2.79402 20.6995 2.5 21.2508" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M17.7084 18.8169C18.8843 18.8169 19.8376 17.8637 19.8376 16.6878C19.8376 15.5119 18.8843 14.5586 17.7084 14.5586C16.5325 14.5586 15.5792 15.5119 15.5792 16.6878C15.5792 17.8637 16.5325 18.8169 17.7084 18.8169Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M20.75 21.2508C20.4559 20.6995 20.0176 20.2385 19.4819 19.917C18.9461 19.5956 18.3331 19.4258 17.7083 19.4258C17.0835 19.4258 16.4705 19.5956 15.9347 19.917C15.399 20.2385 14.9606 20.6995 14.6666 21.2508" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M11.625 7.25833C12.8009 7.25833 13.7542 6.30507 13.7542 5.12917C13.7542 3.95326 12.8009 3 11.625 3C10.4491 3 9.49585 3.95326 9.49585 5.12917C9.49585 6.30507 10.4491 7.25833 11.625 7.25833Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M14.2603 9.08466C13.9352 8.70299 13.5311 8.39646 13.076 8.18626C12.6208 7.97605 12.1255 7.86719 11.6241 7.86719C11.1228 7.86719 10.6275 7.97605 10.1723 8.18626C9.71717 8.39646 9.3131 8.70299 8.98804 9.08466" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M9.23303 18.3779C10.7865 18.9701 12.5044 18.9649 14.0543 18.3633" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M7.04138 7.25781C6.37549 7.88147 5.84473 8.63521 5.48198 9.47233C5.11923 10.3095 4.9322 11.2121 4.9325 12.1245C4.9325 12.3297 4.94466 12.53 4.96332 12.7328" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M18.2857 12.7328C18.3036 12.5317 18.3165 12.3273 18.3165 12.1245C18.317 11.2121 18.13 10.3094 17.7672 9.47224C17.4045 8.6351 16.8736 7.88138 16.2076 7.25781" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

/** Folded category: Archived (`messages/archive.svg`). */
export function WzArchiveIcon({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden focusable="false" {...props}>
      <path d="M3.85254 8V10.0844V18.0221C3.85254 18.6869 4.11663 19.3245 4.58672 19.7946C5.05682 20.2647 5.6944 20.5288 6.35921 20.5288H17.6392C18.304 20.5288 18.9416 20.2647 19.4117 19.7946C19.8818 19.3245 20.1459 18.6869 20.1459 18.0221V10.0844V8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M20.1463 3.40002H3.85294C3.52054 3.40002 3.20175 3.53207 2.9667 3.76712C2.73166 4.00216 2.59961 4.32095 2.59961 4.65336V7.16002H21.3996V4.65336C21.3996 4.32095 21.2676 4.00216 21.0325 3.76712C20.7975 3.53207 20.4787 3.40002 20.1463 3.40002Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M11.9863 17.2V10.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M8.77162 14.6286L11.9859 17.2L15.2002 14.6286" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

/** List bar: New group (`groupChat.svg`). */
export function WzGroupChatIcon({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 19" fill="none" aria-hidden focusable="false" {...props}>
      <path d="M7.23056 7.23072C8.95113 7.23072 10.3459 5.83593 10.3459 4.11536C10.3459 2.39479 8.95113 1 7.23056 1C5.51 1 4.1152 2.39479 4.1152 4.11536C4.1152 5.83593 5.51 7.23072 7.23056 7.23072Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M13.4614 17.6154H1V16.2308C1 14.5784 1.65645 12.9935 2.82494 11.8251C3.99342 10.6566 5.57823 10.0001 7.23072 10.0001C8.88321 10.0001 10.468 10.6566 11.6365 11.8251C12.805 12.9935 13.4614 14.5784 13.4614 16.2308V17.6154Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M12.7686 1C13.5949 1 14.3873 1.32822 14.9715 1.91247C15.5558 2.49671 15.884 3.28912 15.884 4.11536C15.884 4.94161 15.5558 5.73401 14.9715 6.31825C14.3873 6.9025 13.5949 7.23072 12.7686 7.23072" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M14.9846 10.2627C16.1641 10.7114 17.1795 11.5076 17.8965 12.546C18.6135 13.5845 18.9983 14.8161 19 16.078V17.6149H16.9231" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

/** List bar: Filter by (`filterMessages.svg`). */
export function WzFilterIcon({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden focusable="false" {...props}>
      <path d="M18.9987 1.64151C19.0041 1.5594 18.9926 1.47706 18.9649 1.39958C18.9372 1.3221 18.8939 1.25111 18.8377 1.19101C18.7815 1.1309 18.7136 1.08295 18.6381 1.05012C18.5627 1.01729 18.4813 1.00028 18.399 1.00012H1.60104C1.51872 1.00016 1.43728 1.0171 1.36178 1.04989C1.28627 1.08268 1.2183 1.13062 1.16208 1.19075C1.10586 1.25088 1.06259 1.32192 1.03494 1.39945C1.00729 1.47699 0.99585 1.55938 1.00134 1.64151C1.14235 3.60497 1.92161 5.46844 3.2203 6.94778C4.519 8.42712 6.26586 9.44115 8.19452 9.83526V17.7524C8.19456 17.8667 8.22715 17.9785 8.28848 18.0749C8.34981 18.1713 8.43734 18.2483 8.54081 18.2967C8.64428 18.3452 8.75942 18.3632 8.87274 18.3485C8.98605 18.3339 9.09286 18.2873 9.18065 18.2142L11.5859 16.2099C11.6537 16.1535 11.7082 16.0829 11.7456 16.0031C11.7831 15.9233 11.8024 15.8362 11.8023 15.7481V9.83526C13.7316 9.4419 15.4793 8.42817 16.7786 6.94875C18.078 5.46933 18.8577 3.60545 18.9987 1.64151V1.64151Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

/** List bar: Search (`searchMessages.svg`). */
export function WzSearchIcon({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden focusable="false" {...props}>
      <path d="M8.50469 16.0094C12.6494 16.0094 16.0094 12.6494 16.0094 8.50469C16.0094 4.35996 12.6494 1 8.50469 1C4.35996 1 1 4.35996 1 8.50469C1 12.6494 4.35996 16.0094 8.50469 16.0094Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M19 19L13.8076 13.8076" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

/** The double tick under a delivered line (`msg_received.svg`, #768287). */
export function WzMessageReceivedIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden focusable="false" {...props}>
      <path d="M22.8159 5L12.164 19.2025C12.044 19.3626 11.891 19.4951 11.7153 19.5909C11.5396 19.6868 11.3454 19.7437 11.1458 19.7579C10.9462 19.7721 10.7459 19.7433 10.5584 19.6733C10.3709 19.6034 10.2006 19.4939 10.0591 19.3524L7.28772 16.581" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M6.75714 19.4399C6.62801 19.572 6.47398 19.6771 6.30396 19.7492C6.13393 19.8213 5.95129 19.859 5.76661 19.86C5.58194 19.861 5.39889 19.8254 5.22806 19.7552C5.05724 19.6851 4.90203 19.5817 4.77143 19.4511L2 16.6843" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M17.3979 5.09863L9.81995 15.2031" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

/** Workiz's AI sparks (`genius/ai_sparks.svg`): the composer's sparkle. */
export function WzAiSparksIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 17" fill="none" aria-hidden focusable="false" {...props}>
      <path d="M4.80002 2.1001C4.6442 2.72081 4.34629 3.29682 3.92979 3.78272C3.5133 4.26861 2.98961 4.6511 2.40002 4.9C2.9897 5.14876 3.51348 5.53119 3.93 6.01711C4.34651 6.50303 4.64436 7.07913 4.80002 7.69991C4.95569 7.07913 5.25354 6.50303 5.67005 6.01711C6.08657 5.53119 6.61034 5.14876 7.20002 4.9C6.61044 4.6511 6.08675 4.26861 5.67026 3.78272C5.25376 3.29682 4.95585 2.72081 4.80002 2.1001Z" fill="url(#wzsp_paint0)" stroke="url(#wzsp_paint1)" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M9.77522 6.8999C9.55608 7.77283 9.13712 8.5829 8.55139 9.26623C7.96566 9.94956 7.22917 10.4875 6.40002 10.8375C7.22931 11.1873 7.96592 11.7252 8.55167 12.4085C9.13743 13.0919 9.55631 13.9021 9.77522 14.7751C9.99414 13.9021 10.413 13.0919 10.9988 12.4085C11.5845 11.7252 12.3211 11.1873 13.1504 10.8375C12.3213 10.4875 11.5848 9.94956 10.9991 9.26623C10.4133 8.5829 9.99437 7.77283 9.77522 6.8999Z" fill="url(#wzsp_paint2)" stroke="url(#wzsp_paint3)" strokeLinecap="round" strokeLinejoin="round"/>
      <defs>
      <linearGradient id="wzsp_paint0" x1="1.7724" y1="8.38974" x2="7.58191" y2="8.32157" gradientUnits="userSpaceOnUse">
      <stop stopColor="#3589E9"/>
      <stop offset="1" stopColor="#D574E4"/>
      </linearGradient>
      <linearGradient id="wzsp_paint1" x1="1.7724" y1="8.38974" x2="7.58191" y2="8.32157" gradientUnits="userSpaceOnUse">
      <stop stopColor="#3589E9"/>
      <stop offset="1" stopColor="#D574E4"/>
      </linearGradient>
      <linearGradient id="wzsp_paint2" x1="5.51738" y1="15.7452" x2="13.6875" y2="15.6494" gradientUnits="userSpaceOnUse">
      <stop stopColor="#3589E9"/>
      <stop offset="1" stopColor="#D574E4"/>
      </linearGradient>
      <linearGradient id="wzsp_paint3" x1="5.51738" y1="15.7452" x2="13.6875" y2="15.6494" gradientUnits="userSpaceOnUse">
      <stop stopColor="#3589E9"/>
      <stop offset="1" stopColor="#D574E4"/>
      </linearGradient>
      </defs>
    </svg>
  );
}

/** A star on a bubble (`favorite-empty-outgoing.svg` white on ink, `-incomming` ink outline on white); filled yellow once starred. */
export function WzStarIcon({ size = 20, tone, starred = false, ...props }: IconProps & { tone: "outgoing" | "incoming"; starred?: boolean }) {
  const fill = starred ? "#fad400" : tone === "outgoing" ? "#ffffff" : "#ffffff";
  return (
    <svg width={size} height={size * 0.95} viewBox="0 0 20 19" fill="none" aria-hidden focusable="false" {...props}>
      {tone === "outgoing" && !starred ? (
        <path d="M9.04894 0.927052C9.3483 0.00574112 10.6517 0.00573993 10.9511 0.927051L12.4697 5.60081C12.6035 6.01284 12.9875 6.2918 13.4207 6.2918H18.335C19.3037 6.2918 19.7065 7.53141 18.9228 8.10081L14.947 10.9894C14.5966 11.244 14.4499 11.6954 14.5838 12.1074L16.1024 16.7812C16.4017 17.7025 15.3472 18.4686 14.5635 17.8992L10.5878 15.0106C10.2373 14.756 9.7627 14.756 9.41221 15.0106L5.43648 17.8992C4.65276 18.4686 3.59828 17.7025 3.89763 16.7812L5.41623 12.1074C5.55011 11.6954 5.40345 11.244 5.05296 10.9894L1.07722 8.10081C0.293507 7.53141 0.696283 6.2918 1.66501 6.2918H6.57929C7.01252 6.2918 7.39647 6.01284 7.53035 5.60081L9.04894 0.927052Z" fill={fill} />
      ) : (
        <path d="M9.52447 1.08156C9.67415 0.620903 10.3259 0.620905 10.4755 1.08156L11.9941 5.75532C12.1949 6.37336 12.7709 6.7918 13.4207 6.7918H18.335C18.8194 6.7918 19.0207 7.4116 18.6289 7.6963L14.6531 10.5848C14.1274 10.9668 13.9074 11.6439 14.1082 12.2619L15.6268 16.9357C15.7765 17.3963 15.2493 17.7794 14.8574 17.4947L10.8817 14.6061C10.3559 14.2242 9.64405 14.2242 9.11832 14.6061L5.14258 17.4947C4.75073 17.7794 4.22349 17.3963 4.37316 16.9357L5.89176 12.2619C6.09257 11.6439 5.87258 10.9668 5.34685 10.5848L1.37111 7.6963C0.979257 7.4116 1.18064 6.7918 1.66501 6.7918H6.57929C7.22913 6.7918 7.80506 6.37336 8.00587 5.75532L9.52447 1.08156Z" fill={fill} stroke="currentColor" />
      )}
    </svg>
  );
}

/** wfi-message: a speech bubble with two lines — the list bar's New message. */
export function WzNewMessageIcon({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden focusable="false" {...props}>
      <path d="M5 4.25h14A1.75 1.75 0 0 1 20.75 6v9.5A1.75 1.75 0 0 1 19 17.25H10.5l-4.25 3.5v-3.5H5A1.75 1.75 0 0 1 3.25 15.5V6A1.75 1.75 0 0 1 5 4.25Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M7.75 9.25h8.5M7.75 12.75h5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** wfi-Native-avatar: the thread header's "Client info". */
export function WzPersonIcon({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden focusable="false" {...props}>
      <circle cx="12" cy="7.75" r="3.75" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4.75 20.25v-.5a7.25 7.25 0 0 1 14.5 0v.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/** wfi-Phone: the thread header's call handset. */
export function WzPhoneIcon({ size = 24, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden focusable="false" {...props}>
      <path d="M8.6 3.6 6.4 3.3a1.7 1.7 0 0 0-1.5.6L3.7 5.4a2.6 2.6 0 0 0-.5 2.3 19.5 19.5 0 0 0 13.1 13.1 2.6 2.6 0 0 0 2.3-.5l1.5-1.2a1.7 1.7 0 0 0 .6-1.5l-.3-2.2a1.2 1.2 0 0 0-.9-1l-3-.8a1.2 1.2 0 0 0-1.2.4l-1.2 1.4a14 14 0 0 1-6-6l1.4-1.2a1.2 1.2 0 0 0 .4-1.2l-.8-3a1.2 1.2 0 0 0-1-.9Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/** workizIcon-forward-msg: a bubble with a pen — "Forward" on a line. */
export function WzForwardIcon({ size = 20, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden focusable="false" {...props}>
      <path d="M20 10.5V5.5A1.5 1.5 0 0 0 18.5 4h-13A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H7v3.5l3.5-3.5h1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m14.25 20.25.6-2.6 5.3-5.3a1.4 1.4 0 0 1 2 2l-5.3 5.3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/** workizIcon-copy: two sheets — "Copy" on a line. */
export function WzCopyIcon({ size = 20, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden focusable="false" {...props}>
      <rect x="4.25" y="2.75" width="11.5" height="14.5" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M18.25 6.25h.25a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H9.25a1.5 1.5 0 0 1-1.5-1.5v-.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** lnr-paperclip: the upright paperclip inside the message box. */
export function WzPaperclipIcon({ size = 18, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden focusable="false" {...props}>
      <path d="M11.5 5.5v7.25a2.5 2.5 0 0 1-5 0V3.75a1.75 1.75 0 0 1 3.5 0v8.5a.75.75 0 0 1-1.5 0V5.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** wfi-ellipsis-kebab-menu: the ⋮ on a row (22px font glyph). */
export function WzKebabIcon({ size = 22, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" fill="currentColor" aria-hidden focusable="false" {...props}>
      <circle cx="11" cy="5" r="1.6" />
      <circle cx="11" cy="11" r="1.6" />
      <circle cx="11" cy="17" r="1.6" />
    </svg>
  );
}
