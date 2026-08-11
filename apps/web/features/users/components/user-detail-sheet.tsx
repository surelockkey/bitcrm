"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Ban, Loader2, MailPlus, MoreHorizontal, RotateCcw } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { User } from "@bitcrm/types";
import { UserStatus } from "@bitcrm/types";
import { usePermissions } from "@/features/auth/use-permissions";
import { updateUserSchema, type UpdateUserValues } from "../schemas";
import {
  useAssignRole,
  useDeactivateUser,
  useReactivateUser,
  useResendInvite,
  useUpdateUser,
} from "../hooks";
import { useHierarchy } from "../use-can-manage";
import { initials, formatDate, roleName } from "../lib";
import { UserStatusBadge } from "./status-badge";
import { UserPermissionsSummary } from "./user-permissions-summary";

export function UserDetailSheet({
  user,
  defaultTab = "profile",
  onClose,
}: {
  user: User;
  defaultTab?: string;
  onClose: () => void;
}) {
  const { can } = usePermissions();
  const { roles, canManage, assignableRoles } = useHierarchy();
  const manageable = canManage(user);

  const updateUser = useUpdateUser();
  const assignRole = useAssignRole();
  const resendInvite = useResendInvite();
  const deactivate = useDeactivateUser();
  const reactivate = useReactivateUser();

  const [pendingRole, setPendingRole] = useState(user.roleId);
  const [confirmRole, setConfirmRole] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  const form = useForm<UpdateUserValues>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: {
      firstName: user.firstName,
      lastName: user.lastName,
      department: user.department,
    },
  });

  const canEdit = can("users", "edit") && manageable;
  const isActive = user.status === UserStatus.ACTIVE;

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        className="flex w-full flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
        onInteractOutside={(e) => {
          // Selects/menus render in a portal outside the sheet; dismissing one
          // must not be treated as an outside-click that closes the sheet too.
          const target = e.target as Element | null;
          if (
            target?.closest(
              '[data-slot="select-content"],[data-radix-popper-content-wrapper],[role="listbox"],[role="menu"]',
            )
          ) {
            e.preventDefault();
          }
        }}
      >
        <SheetHeader className="border-b">
          <div className="flex items-start gap-3 pr-10">
            <Avatar className="size-11">
              <AvatarFallback>{initials(user.firstName, user.lastName)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate">
                {user.firstName} {user.lastName}
              </SheetTitle>
              <div className="truncate text-sm text-muted-foreground">{user.email}</div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary">{roleName(user.roleId, roles)}</Badge>
                <span className="text-xs text-muted-foreground">{user.department}</span>
                <UserStatusBadge status={user.status} />
              </div>
            </div>
            <UserHeaderActions
              canResend={can("users", "create")}
              canDeactivate={can("users", "delete") && manageable}
              canReactivate={can("users", "edit") && manageable}
              isActive={isActive}
              onResend={() => resendInvite.mutate(user.id)}
              onDeactivate={() => setConfirmDeactivate(true)}
              onReactivate={() => reactivate.mutate(user.id)}
            />
          </div>
        </SheetHeader>

        <Tabs defaultValue={defaultTab} className="flex flex-1 flex-col overflow-hidden">
          <div className="border-b px-4">
            <TabsList variant="line" className="h-10">
              <TabsTrigger value="profile" className="px-2">Profile</TabsTrigger>
              <TabsTrigger value="role" className="px-2">Role &amp; access</TabsTrigger>
              <TabsTrigger value="permissions" className="px-2">Permissions</TabsTrigger>
              <TabsTrigger value="activity" className="px-2">Activity</TabsTrigger>
            </TabsList>
          </div>

          {/* Profile */}
          <TabsContent value="profile" className="flex-1 overflow-y-auto p-4">
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit((v) =>
                  updateUser.mutate({ id: user.id, body: v }),
                )}
                className="space-y-4"
                noValidate
              >
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="firstName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>First name</FormLabel>
                        <FormControl>
                          <Input className="h-10" disabled={!canEdit} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="lastName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Last name</FormLabel>
                        <FormControl>
                          <Input className="h-10" disabled={!canEdit} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <Input className="h-10" value={user.email} readOnly disabled />
                  <p className="text-xs text-muted-foreground">Email can&apos;t be changed.</p>
                </FormItem>
                <FormField
                  control={form.control}
                  name="department"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Department</FormLabel>
                      <FormControl>
                        <Input className="h-10" disabled={!canEdit} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {canEdit ? (
                  <div className="flex justify-end">
                    <Button type="submit" variant="brand" disabled={updateUser.isPending} className="gap-1.5">
                      {updateUser.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                      Save changes
                    </Button>
                  </div>
                ) : null}
              </form>
            </Form>
          </TabsContent>

          {/* Role & access */}
          <TabsContent value="role" className="flex-1 overflow-y-auto p-4">
            <div className="space-y-4">
              <div>
                <div className="text-sm font-medium">Current role</div>
                <Badge variant="secondary" className="mt-1">
                  {roleName(user.roleId, roles)}
                </Badge>
              </div>
              {can("users", "edit") && manageable ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Change role</label>
                  <Select value={pendingRole} onValueChange={setPendingRole}>
                    <SelectTrigger className="h-10 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {assignableRoles(roles).map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Changing the role resets this user&apos;s custom permission overrides.
                  </p>
                  <div className="flex justify-end">
                    <Button
                      variant="brand"
                      disabled={pendingRole === user.roleId || assignRole.isPending}
                      onClick={() => setConfirmRole(true)}
                      className="gap-1.5"
                    >
                      {assignRole.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                      Update role
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  You don&apos;t have permission to change this user&apos;s role.
                </p>
              )}
            </div>
          </TabsContent>

          {/* Permissions */}
          <TabsContent value="permissions" className="flex-1 overflow-y-auto p-4">
            <UserPermissionsSummary
              user={user}
              roleLabel={roleName(user.roleId, roles)}
              canEdit={canEdit}
              onClose={onClose}
            />
          </TabsContent>

          {/* Activity */}
          <TabsContent value="activity" className="flex-1 overflow-y-auto p-4">
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Created</dt>
                <dd>{formatDate(user.createdAt)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Last updated</dt>
                <dd>{formatDate(user.updatedAt)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">User ID</dt>
                <dd className="font-mono text-xs">{user.id}</dd>
              </div>
            </dl>
          </TabsContent>
        </Tabs>
      </SheetContent>

      {/* Confirm: change role */}
      <AlertDialog open={confirmRole} onOpenChange={setConfirmRole}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change this user&apos;s role?</AlertDialogTitle>
            <AlertDialogDescription>
              They&apos;ll get the permissions of{" "}
              <strong>{roleName(pendingRole, roles)}</strong>. Any custom
              permission overrides on this user will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => assignRole.mutate({ id: user.id, roleId: pendingRole })}
            >
              Update role
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm: deactivate */}
      <AlertDialog open={confirmDeactivate} onOpenChange={setConfirmDeactivate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {user.firstName}?</AlertDialogTitle>
            <AlertDialogDescription>
              They lose access immediately. Their history is kept and you can
              reactivate them later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                deactivate.mutate(user.id);
                onClose();
              }}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}

function UserHeaderActions({
  canResend,
  canDeactivate,
  canReactivate,
  isActive,
  onResend,
  onDeactivate,
  onReactivate,
}: {
  canResend: boolean;
  canDeactivate: boolean;
  canReactivate: boolean;
  isActive: boolean;
  onResend: () => void;
  onDeactivate: () => void;
  onReactivate: () => void;
}) {
  const anything = canResend || (isActive ? canDeactivate : canReactivate);
  if (!anything) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="User actions">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {canResend ? (
          <DropdownMenuItem onClick={onResend}>
            <MailPlus />
            Resend invite
          </DropdownMenuItem>
        ) : null}
        {isActive
          ? canDeactivate && (
              <DropdownMenuItem variant="destructive" onClick={onDeactivate}>
                <Ban />
                Deactivate
              </DropdownMenuItem>
            )
          : canReactivate && (
              <DropdownMenuItem onClick={onReactivate}>
                <RotateCcw />
                Reactivate
              </DropdownMenuItem>
            )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
