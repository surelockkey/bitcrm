import type { AutomationTemplateSection } from "../templates";

/*
 * The Discover categories' glyphs, Workiz's own (assets.workiz.com/latest/
 * _assets/img/icons/{reminder,megaphone}.svg, svg/phone_outlined.svg,
 * img/icons/ruleAction.svg), drawn 20×20 in ink as Workiz's `<img>`s are.
 * Job status is ours; it wears Workiz's Actions glyph (the ticked circle).
 */

function Bell() {
  return (
    <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 16 16" fill="none">
      <path
        d="M7.94149 0.5C9.24407 0.5 10.4933 1.01745 11.4144 1.93851C12.3354 2.85957 12.8529 4.1088 12.8529 5.41138C12.8529 10.8723 14.8449 11.9484 15.383 11.9484H0.5C1.04953 11.9484 3.03011 10.8608 3.03011 5.41138C3.03011 4.1088 3.54755 2.85957 4.46862 1.93851C5.38968 1.01745 6.63891 0.5 7.94149 0.5V0.5Z"
        stroke="#3B4B52"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.22375 14.0435C6.32272 14.4236 6.545 14.7602 6.85577 15.0004C7.16654 15.2406 7.54823 15.371 7.94102 15.371C8.33381 15.371 8.7155 15.2406 9.02627 15.0004C9.33704 14.7602 9.55933 14.4236 9.65829 14.0435"
        stroke="#3B4B52"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Megaphone() {
  return (
    <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 19" fill="none">
      <path fillRule="evenodd" clipRule="evenodd" d="M6.76 13H4.6C2.61178 13 1 11.3211 1 9.25C1 7.17893 2.61178 5.5 4.6 5.5H6.76V13Z" stroke="#3B4B52" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path fillRule="evenodd" clipRule="evenodd" d="M6.76001 13C10.9851 13.0004 15.1156 14.3031 18.6314 16.744L19.72 17.5V1L18.6314 1.756C15.1156 4.19694 10.9851 5.49963 6.76001 5.5V13Z" stroke="#3B4B52" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M22.6001 7.75V10.75" stroke="#3B4B52" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.76001 13C6.75877 14.9844 7.53964 16.8824 8.92001 18.25" stroke="#3B4B52" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Phone() {
  return (
    <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 16 16" fill="none">
      <path
        d="M9.62011 13.5336L9.62666 13.5382C10.1933 13.899 10.866 14.0557 11.5337 13.9824C12.2014 13.909 12.8241 13.6101 13.299 13.1349L13.7114 12.7223C13.8028 12.631 13.8753 12.5225 13.9248 12.4031C13.9743 12.2837 13.9998 12.1557 13.9998 12.0265C13.9998 11.8973 13.9743 11.7693 13.9248 11.6499C13.8753 11.5305 13.8028 11.422 13.7114 11.3307L11.9717 9.59205C11.8803 9.50063 11.7719 9.42811 11.6525 9.37864C11.5331 9.32916 11.4051 9.30369 11.2759 9.30369C11.1467 9.30369 11.0187 9.32916 10.8993 9.37864C10.78 9.42811 10.6715 9.50063 10.5801 9.59205C10.3957 9.77647 10.1455 9.88008 9.88471 9.88008C9.62388 9.88008 9.37373 9.77647 9.18927 9.59205L6.40751 6.80935C6.2231 6.62487 6.11951 6.37469 6.11951 6.11383C6.11951 5.85298 6.2231 5.6028 6.40751 5.41832C6.49892 5.32697 6.57143 5.21849 6.6209 5.09909C6.67037 4.9797 6.69584 4.85172 6.69584 4.72248C6.69584 4.59324 6.67037 4.46527 6.6209 4.34587C6.57143 4.22648 6.49892 4.118 6.40751 4.02664L4.66842 2.28803C4.48396 2.1036 4.23381 2 3.97298 2C3.71215 2 3.462 2.1036 3.27754 2.28803L2.8644 2.70055C2.38936 3.17549 2.09055 3.7983 2.01734 4.46607C1.94413 5.13385 2.10091 5.80662 2.46176 6.37322L2.4657 6.37978C4.37147 9.19972 6.8001 11.6282 9.62011 13.5336Z"
        stroke="#3B4B52"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TickedCircle() {
  return (
    <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M7.15381 13.6154L10.4653 16.2647C10.5543 16.3379 10.6584 16.3904 10.7702 16.4183C10.882 16.4463 10.9986 16.449 11.1115 16.4262C11.2255 16.4048 11.3336 16.3591 11.4284 16.2922C11.5231 16.2253 11.6024 16.1388 11.6607 16.0385L16.8461 7.15389"
        stroke="#566D76"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 22.5C17.799 22.5 22.5 17.799 22.5 12C22.5 6.20101 17.799 1.5 12 1.5C6.20101 1.5 1.5 6.20101 1.5 12C1.5 17.799 6.20101 22.5 12 22.5Z"
        stroke="#3B4B52"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export const SECTION_ICON: Record<AutomationTemplateSection, () => React.JSX.Element> = {
  Reminders: Bell,
  Marketing: Megaphone,
  Phone,
  "Job status": TickedCircle,
};
