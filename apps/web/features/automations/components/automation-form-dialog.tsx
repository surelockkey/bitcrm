/**
 * The rule editor, which is now the node builder (`builder/automation-builder`,
 * `docs/import/WORKIZ_AUTOMATION_BUILDER_UI.md`). The seven stacked sections
 * that used to live here are gone — the owner's words for them were "чорт ногу
 * зломить" — and the chain took their place.
 *
 * The name stays so every call site keeps working: the page opens "the rule
 * editor", and which editor that is has never been the page's business.
 */
export {
  AutomationBuilderDialog as AutomationFormDialog,
  type AutomationDraft,
} from "../builder/automation-builder";
