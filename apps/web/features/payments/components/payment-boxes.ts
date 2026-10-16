/*
 * Workiz's Add payment, measured off its own window (Credit charge, at 1.2×):
 * 520px wide, 48px boxes with their label inside and 4px corners, rows
 * 58.64px apart, a bold 14px balance line under the title, and a 56px footer
 * whose Close and Charge are 200×34 pills 36px in from either edge.
 *
 * Shared by the dialog and the lazily loaded card form, so neither imports
 * the other just for a class.
 */

/** The kit's 48px text box with Workiz's modal corners. */
export const PAYMENT_BOX = "rounded-[4px]";

/** Two boxes side by side: Amount · Payment type, Confirmation code · Paid on. */
export const PAYMENT_PAIR = "grid grid-cols-2 gap-x-2.5";

/** The footer strip: Close at the left edge, the action at the right. */
export const PAYMENT_FOOTER = "mt-[18px] px-9 py-[11px] sm:justify-between";

/** Workiz's footer pills. */
export const PAYMENT_BUTTON = "h-[34px] w-[200px] max-sm:w-full";
