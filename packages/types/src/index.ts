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
export { DealStage, DealStageGroup, STAGE_GROUPS, TERMINAL_STAGES } from './enums/deal-stage.enum';
export { DealPriority } from './enums/deal-priority.enum';
export { DealStatus } from './enums/deal-status.enum';
export { TimelineEventType } from './enums/timeline-event-type.enum';
export { JobType } from './enums/job-type.enum';

// Entities
export { User } from './entities/user.entity';
export { Role } from './entities/role.entity';
export { Contact } from './entities/contact.entity';
export { Company } from './entities/company.entity';
export { Address } from './entities/address.entity';
export { Deal } from './entities/deal.entity';
export { DealProduct } from './entities/deal-product.entity';
export { TimelineEntry } from './entities/timeline-entry.entity';
export { Product } from './entities/product.entity';
export { Warehouse } from './entities/warehouse.entity';
export { Container } from './entities/container.entity';
export { Transfer, TransferItem } from './entities/transfer.entity';
export { StockItem } from './entities/stock-item.entity';

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

// Auth
export { JwtUser } from './auth/jwt-user';

// Responses
export { ApiResponse, PaginatedResponse } from './responses/api-response';
