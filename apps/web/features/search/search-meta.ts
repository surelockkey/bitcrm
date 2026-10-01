import {
  ArrowLeftRight,
  Boxes,
  Building2,
  Handshake,
  MessageSquare,
  Package,
  Truck,
  User,
  UserCog,
  Warehouse,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { SEARCH_TYPES, type SearchType } from "@bitcrm/types";

/** Display label (group heading) + icon for each searchable entity type. */
export const SEARCH_TYPE_META: Record<SearchType, { label: string; icon: LucideIcon }> = {
  deal: { label: "Jobs", icon: Handshake },
  contact: { label: "Contacts", icon: User },
  company: { label: "Companies", icon: Building2 },
  user: { label: "Users", icon: UserCog },
  technician: { label: "Technicians", icon: Wrench },
  product: { label: "Products", icon: Package },
  warehouse: { label: "Warehouses", icon: Warehouse },
  container: { label: "Containers", icon: Truck },
  transfer: { label: "Transfers", icon: ArrowLeftRight },
  stock: { label: "Stock", icon: Boxes },
  conversation: { label: "Messages", icon: MessageSquare },
};

/**
 * What the global search (⌘K) asks for: every type but the item catalog —
 * products and their stock. Workiz's search doesn't find items, and the
 * owner wants the same here. Pickers that do want items ask for them by name.
 */
export const GLOBAL_SEARCH_TYPES: readonly SearchType[] = SEARCH_TYPES.filter(
  (t) => t !== "product" && t !== "stock",
);
