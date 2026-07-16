import {
  ArrowLeftRight,
  Boxes,
  Building2,
  Handshake,
  Package,
  Truck,
  User,
  UserCog,
  Warehouse,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { SearchType } from "@bitcrm/types";

/** Display label (group heading) + icon for each searchable entity type. */
export const SEARCH_TYPE_META: Record<SearchType, { label: string; icon: LucideIcon }> = {
  deal: { label: "Deals", icon: Handshake },
  contact: { label: "Contacts", icon: User },
  company: { label: "Companies", icon: Building2 },
  user: { label: "Users", icon: UserCog },
  technician: { label: "Technicians", icon: Wrench },
  product: { label: "Products", icon: Package },
  warehouse: { label: "Warehouses", icon: Warehouse },
  container: { label: "Containers", icon: Truck },
  transfer: { label: "Transfers", icon: ArrowLeftRight },
  stock: { label: "Stock", icon: Boxes },
};
