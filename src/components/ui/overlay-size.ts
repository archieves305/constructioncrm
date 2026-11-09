/**
 * The widths a dialog or sheet may take. Pages pick a size, never a width, so
 * the same kind of dialog is the same width everywhere (ESLint refuses a
 * hand-set max-w on DialogContent / SheetContent).
 *
 * Dialogs: sm = a confirmation or one field; md = an ordinary form; lg = a
 * form with two columns or a short table; xl = a document beside its fields
 * or a wide table; full = a workspace. Below 640 px every size is the phone's
 * width less a 1 rem margin, and every dialog scrolls inside the screen.
 */
export type DialogSize = "sm" | "md" | "lg" | "xl" | "full";
export type SheetSize = "sm" | "md" | "lg" | "xl";

export const DIALOG_SIZE_CLASS: Record<DialogSize, string> = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
  xl: "sm:max-w-4xl",
  full: "sm:max-w-6xl",
};

/** Side sheets: the whole width on a phone, then this much from 640 px. */
export const SHEET_SIZE_CLASS: Record<SheetSize, string> = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-lg",
  lg: "sm:max-w-xl",
  xl: "sm:max-w-2xl",
};
