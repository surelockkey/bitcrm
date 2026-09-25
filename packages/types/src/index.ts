// Enums
export { UserStatus } from './enums/user-status.enum';
export { DataScope } from './enums/data-scope.enum';
export { ProductType } from './enums/product-type.enum';
export { TransferType, LocationType } from './enums/transfer-type.enum';
export { InventoryStatus } from './enums/inventory-status.enum';
export { ContactType } from './enums/contact-type.enum';
export { ContactSource } from './enums/contact-source.enum';
export { ClientType } from './enums/client-type.enum';
export { CrmStatus } from './enums/crm-status.enum';
export { PaymentTerms } from './enums/payment-terms.enum';
export { WorkOrderStatus } from './enums/work-order-status.enum';
export { CompanyDocumentType } from './enums/company-document-type.enum';
export { DealStage, DealStageGroup, STAGE_GROUPS, TERMINAL_STAGES } from './enums/deal-stage.enum';
export {
  JobSuperStatus,
  SUPER_STATUS_ORDER,
  TERMINAL_SUPER_STATUSES,
  CLOSED_SUPER_STATUSES,
  STAGE_TO_SUPER_STATUS,
} from './enums/deal-stage.enum';
export { DealPriority } from './enums/deal-priority.enum';
export { DealStatus } from './enums/deal-status.enum';
export { TimelineEventType } from './enums/timeline-event-type.enum';
export { CalendarEventType } from './enums/calendar-event-type.enum';
export { ServiceAreaType } from './enums/service-area-type.enum';
export { JOB_TAG_COLORS, JobTagColor } from './enums/job-tag-color.enum';
export {
  CUSTOM_FIELD_TYPES,
  CustomFieldType,
  OPTION_CUSTOM_FIELD_TYPES,
  isOptionCustomFieldType,
} from './enums/custom-field-type.enum';

// Entities
export { User } from './entities/user.entity';
export { Role } from './entities/role.entity';
export { Contact } from './entities/contact.entity';
export { Company } from './entities/company.entity';
export { WorkOrder } from './entities/work-order.entity';
export { CompanyDocument } from './entities/company-document.entity';
export { Address } from './entities/address.entity';
export { Deal, SEND_TO_TECH_CHANNELS } from './entities/deal.entity';
export type { SendToTechChannel, DealTotalsSnapshot } from './entities/deal.entity';
export { DealAttachment, DealAttachmentMeta } from './entities/deal-attachment.entity';
export {
  CallGroup,
  CallGroupChannel,
  CallGroupMember,
  CallGroupType,
  CallGroupWithMembers,
  ResolvedCallGroupMember,
} from './entities/call-group.entity';
export { CALL_GROUP_LIMITS } from './entities/call-group.entity';
export {
  CallFlow,
  CallFlowNode,
  CallFlowNodeType,
  BusinessHoursWindow,
  CallFlowAudio,
  ExtNode,
  HangupNode,
  HoursNode,
  MenuNode,
  MenuOption,
  RingNode,
  SayNode,
  VoicemailNode,
} from './entities/call-flow.entity';
export { CALL_FLOW_LIMITS } from './entities/call-flow.entity';
export { CallTag, CALL_TAG_LIMITS } from './entities/call-tag.entity';
export { JobType } from './entities/job-type.entity';
export { JobSource } from './entities/job-source.entity';
export { ExternalCompany } from './entities/external-company.entity';
export { JobTag } from './entities/job-tag.entity';
export {
  JOB_REQUIRABLE_FIELDS,
  DEFAULT_JOB_FIELD_SETTINGS,
  JobRequirableFieldId,
  JobFieldSettings,
} from './entities/job-field-settings.entity';
export { DealSubStatus } from './entities/deal-sub-status.entity';
export {
  CustomFieldDefinition,
  CustomFieldValue,
} from './entities/custom-field.entity';
export {
  ServiceArea,
  ServiceAreaDefinition,
  CoverageShape,
  GeoPoint,
  ZipEntry,
  ServiceAreaTax,
  DEFAULT_TIMEZONE,
} from './entities/service-area.entity';
export {
  DealProduct,
  DealProductFulfillment,
  DealProductPriceSource,
} from './entities/deal-product.entity';
export { TimelineEntry } from './entities/timeline-entry.entity';
export {
  Product,
  ProductWithExtras,
  WORKIZ_SERVICE_TYPES,
  WorkizProductType,
} from './entities/product.entity';
export { Warehouse } from './entities/warehouse.entity';
export { Container } from './entities/container.entity';
export { ProductCategory, UNCATEGORIZED_CATEGORY } from './entities/product-category.entity';
export { Brand } from './entities/brand.entity';
export { Transfer, TransferItem } from './entities/transfer.entity';
export { StockItem } from './entities/stock-item.entity';
export {
  TechnicianProfile,
  TechnicianProfileStatus,
  TechnicianType,
  TechnicianHomeAddress,
  OnboardingStatus,
} from './entities/technician-profile.entity';
export { TechnicianLocation } from './entities/technician-location.entity';
export { CalendarEvent } from './entities/calendar-event.entity';
export {
  TechnicianJobType,
  TechnicianServiceArea,
  AssignmentStatus,
  AssignableTechnicianSubject,
} from './entities/technician-assignment.entity';
export {
  isAssignable,
  isAssignableTechnician,
  isFieldTeamMember,
  TECHNICIAN_ROLE_ID,
} from './entities/technician-assignment.entity';
export {
  CommissionConfig,
  CommissionBreakdown,
} from './entities/commission-config.entity';
export {
  TechnicianDocument,
  DocumentType,
} from './entities/technician-document.entity';

// Event contract (user-events topic)
export {
  USER_EVENT_TOPIC,
  UserEventType,
  TechChangedField,
  affectsEligibility,
} from './events/user-events';
export type {
  UserActivatedEvent,
  UserRoleChangedEvent,
  UserInviteResentEvent,
  TechUpdatedEvent,
  TechApprovedEvent,
  CommissionUpdatedEvent,
  DocumentEvent,
  SensitiveAccessedEvent,
} from './events/user-events';

// Event contract (call-events topic)
export { CALL_EVENT_TOPIC, CallEventType } from './events/call-events';
export type {
  CallStartedEvent,
  CallCompletedEvent,
  CallRecordingReadyEvent,
  CallUpdatedEvent,
} from './events/call-events';

// Messaging (client inbox + team chat) — enums
export {
  MESSAGE_CHANNELS,
  SENDABLE_MESSAGE_CHANNELS,
  MESSAGE_ATTACHMENT_TYPES,
  isSmsChannel,
} from './enums/message-channel.enum';
export type {
  MessageChannel,
  SendableMessageChannel,
  MessageAttachmentType,
} from './enums/message-channel.enum';
export { MESSAGE_DIRECTIONS } from './enums/message-direction.enum';
export type { MessageDirection } from './enums/message-direction.enum';
export {
  MESSAGE_STATUSES,
  MESSAGE_STATUS_RANK,
  TERMINAL_MESSAGE_STATUSES,
  isTerminalMessageStatus,
  canAdvanceMessageStatus,
} from './enums/message-status.enum';
export type { MessageStatus } from './enums/message-status.enum';
export {
  CONVERSATION_KINDS,
  CONVERSATION_STATES,
  CONVERSATION_PARTY_KINDS,
  CONVERSATION_POINTER_KINDS,
  CONVERSATION_VIEWS,
} from './enums/conversation-kind.enum';
export type {
  ConversationKind,
  ConversationState,
  ConversationPartyKind,
  ConversationPointerKind,
  ConversationView,
} from './enums/conversation-kind.enum';
export {
  MESSAGE_ORIGINS,
  MESSAGE_PROVIDERS,
  SENDER_SOURCES,
  MESSAGE_ATTACHMENT_STATUSES,
} from './enums/message-origin.enum';
export type {
  MessageOrigin,
  MessageProvider,
  SenderSource,
  MessageAttachmentStatus,
} from './enums/message-origin.enum';
export {
  OPT_OUT_CHANNELS,
  OPT_OUT_STATUSES,
  OPT_OUT_SOURCES,
  OPT_OUT_KEYWORDS,
  OPT_IN_KEYWORDS,
} from './enums/opt-out.enum';
export type { OptOutChannel, OptOutStatus, OptOutSource } from './enums/opt-out.enum';

// Messaging — entities
export { CONVERSATION_MEMBER_ROLES, CONVERSATION_GROUP_MAX_MEMBERS } from './entities/conversation.entity';
export type {
  Conversation,
  ConversationAddresses,
  ConversationLeadProvider,
  ConversationPointer,
  ConversationAddressPointer,
  ConversationReadMarker,
  ConversationMember,
  ConversationMemberRole,
  ConversationParticipant,
} from './entities/conversation.entity';
export {
  MESSAGE_ATTACHMENT_LIMIT,
  SMS_BODY_MAX_LENGTH,
  EMAIL_BODY_MAX_LENGTH,
  MESSAGE_PREVIEW_LENGTH,
} from './entities/message.entity';
export type { Message, MessageAttachment } from './entities/message.entity';
export { MESSAGE_TEMPLATE_CHANNELS } from './entities/message-template.entity';
export type {
  MessageTemplate,
  MessageTemplateChannel,
} from './entities/message-template.entity';
export { OPT_OUT_HISTORY_LIMIT } from './entities/opt-out.entity';
export type { OptOut, OptOutHistoryEntry } from './entities/opt-out.entity';
export type {
  MessagingSettings,
  QuietHours,
} from './entities/messaging-settings.entity';
export {
  EMPTY_INBOX_COUNTERS,
  EMPTY_INBOX_TOTALS,
  EMPTY_TEAM_CHAT_COUNTERS,
} from './entities/inbox-counters.entity';
export type { InboxCounters, InboxTotals, TeamChatCounters } from './entities/inbox-counters.entity';
export { SEND_UNAVAILABLE_REASONS } from './entities/send-options.entity';
export type {
  ConversationSendOptions,
  SendChannelOption,
  SendUnavailableReason,
} from './entities/send-options.entity';
export { BUILTIN_AUTOMATION_RULE_IDS } from './entities/automation-rule.entity';
export type { AutomationRule, BuiltinAutomationRuleId } from './entities/automation-rule.entity';
export {
  AUTOMATION_ACTION_TYPES,
  AUTOMATION_CONDITION_FIELDS,
  AUTOMATION_CONDITION_OPS,
  AUTOMATION_OWN_SPEC_SOURCES,
  AUTOMATION_RECIPIENTS,
  AUTOMATION_RUN_OUTCOMES,
  AUTOMATION_TRIGGER_KINDS,
  automationActionSentence,
  automationConditionLeaves,
  automationConditionsSentence,
  automationDelayText,
  automationSentence,
  automationSpecLabels,
  automationTriggerSentence,
  isAutomationConditionGroup,
  isOwnAutomationSpec,
} from './entities/automation-spec';
export type {
  AutomationAction,
  AutomationActionType,
  AutomationCallOutcome,
  AutomationCondition,
  AutomationConditionField,
  AutomationConditionGroup,
  AutomationConditionNode,
  AutomationConditionOp,
  AutomationLabelMap,
  AutomationQuietHoursMode,
  AutomationRecipient,
  AutomationRun,
  AutomationRunAction,
  AutomationRunOutcome,
  AutomationScheduleAnchor,
  AutomationSpec,
  AutomationSpecSource,
  AutomationTiming,
  AutomationTrigger,
  AutomationTriggerKind,
} from './entities/automation-spec';

// Event contract (deal-events topic)
export { DEAL_EVENT_TOPIC, DealEventType } from './events/deal-events';
export type {
  DealCreatedEvent,
  DealDeletedEvent,
  DealScheduleSlice,
  DealScheduledChangedEvent,
  DealSentToTechEvent,
  DealStatusChangedEvent,
  DealTechAssignedEvent,
  DealTechUnassignedEvent,
  DealUpdatedEvent,
} from './events/deal-events';

// Event contract (message-events topic)
export { MESSAGE_EVENT_TOPIC, MessageEventType } from './events/message-events';
export type {
  MessageReceivedEvent,
  MessageSentEvent,
  MessageStatusChangedEvent,
  ConversationUpdatedEvent,
  OptOutChangedEvent,
} from './events/message-events';

// Billing (taxes, invoices, estimates, document templates, client portal)
export {
  calculateDocumentTotals,
  effectiveTaxRatePercent,
  lineAmount,
} from './billing/totals';
export type {
  DocumentDiscount,
  DocumentTaxSource,
  DocumentTotals,
  TotalsInput,
  TotalsLine,
} from './billing/totals';
export type { TaxRate } from './entities/tax-rate.entity';
export { INVOICE_STATUSES } from './entities/invoice.entity';
export type { Invoice, InvoiceStatus, InvoiceView, BillingLine } from './entities/invoice.entity';
export { ESTIMATE_STATUSES } from './entities/estimate.entity';
export type {
  Estimate,
  EstimateItem,
  EstimateStatus,
  EstimateWithItems,
} from './entities/estimate.entity';
export { DEFAULT_BUSINESS_PROFILE, DEFAULT_BUSINESS_PROFILE_ID } from './entities/business-profile.entity';
export type { BusinessProfile, BusinessProfileView, BillingAsset } from './entities/business-profile.entity';
export type { PortalLink, PortalDocumentSummary, PortalView } from './entities/portal.entity';
export {
  DOCUMENT_TEMPLATE_KINDS,
  DOCUMENT_BLOCK_TYPES,
  ITEMS_TABLE_COLUMNS,
  DEFAULT_DOCUMENT_VISIBILITY,
} from './entities/document-template.entity';
export type {
  DocumentTemplateKind,
  DocumentBlockType,
  TextAlign,
  BlockStyle,
  RichTextNode,
  TextBlock,
  ImageBlock,
  LogoBlock,
  DividerBlock,
  SpacerBlock,
  TableBlock,
  FieldBlock,
  ItemsTableColumn,
  ItemsTableBlock,
  TotalsBlock,
  SignatureBlock,
  NotesBlock,
  PageBreakBlock,
  DocumentBlock,
  DocumentColumn,
  DocumentRow,
  DocumentPageSettings,
  DocumentVisibility,
  DocumentTemplateContent,
  DocumentTemplate,
  DocumentTemplateSummary,
  DocumentRenderContext,
} from './entities/document-template.entity';
export { BILLING_EVENT_TOPIC, BillingEventType } from './events/billing-events';
export type { InvoiceEvent, EstimateEvent } from './events/billing-events';

// Permissions
export {
  PermissionMatrix,
  DataScopeRules,
  UserPermissionOverrides,
} from './permissions/permission-matrix';
export { ResolvedPermissions } from './permissions/resolved-permissions';
export { RESOURCE_REGISTRY, Resource, Action } from './permissions/resource-registry';

// DTOs
export { CreateUserRequest } from './dto/create-user.dto';
export { UpdateUserRequest } from './dto/update-user.dto';
export { ListUsersQuery } from './dto/list-users-query.dto';
export { LoginRequest, LoginResponse, LoginChallengeResponse } from './dto/login.dto';
export { RefreshTokenRequest, RefreshTokenResponse } from './dto/refresh-token.dto';
export { ChangePasswordRequest, ChangePasswordResponse } from './dto/change-password.dto';
export { CreateRoleRequest } from './dto/create-role.dto';
export { UpdateRoleRequest } from './dto/update-role.dto';
export { UpdateUserPermissionsRequest } from './dto/update-user-permissions.dto';

// Search
export {
  SearchType,
  SearchDocStatus,
  SearchDocument,
  SEARCH_TYPES,
  SEARCH_TYPE_TO_RESOURCE,
} from './search/search-document';
export {
  SearchMode,
  SearchHit,
  SearchGroup,
  SearchResponse,
} from './search/search-response';

// Auth
export { JwtUser } from './auth/jwt-user';

// Responses
export { ApiResponse, PaginatedResponse, ListCount } from './responses/api-response';
