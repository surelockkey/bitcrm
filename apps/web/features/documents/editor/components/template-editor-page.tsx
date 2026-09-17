"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, Loader2, MonitorSmartphone, MousePointerClick } from "lucide-react";
import { validateTemplateContent } from "@bitcrm/document-renderer";
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
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/features/auth/use-permissions";
import { getApiErrorMessage } from "@/lib/api/errors";
import { queryKeys } from "@/lib/query-keys";
import { getTemplate } from "../../api";
import { useAssetUrls, useBusinessProfile, useDocumentTemplate, useSampleContext, useSaveTemplate } from "../../hooks";
import { collectAssetIds, isVersionConflict, kindHasDefault } from "../../lib";
import { templateNameSchema } from "../../schemas";
import { selectIsDirty, useEditorStore } from "../store";
import { useEditorUi } from "../ui-store";
import { LEAVE_MESSAGE, useEditorShortcuts, useLeaveGuard } from "../use-editor-shortcuts";
import { TemplateCanvas } from "./canvas";
import { EditorDnd } from "./editor-dnd";
import { LeftPanel } from "./left-panel";
import { LivePreview } from "./preview";
import { PropertiesPanel } from "./properties-panel";
import { TextToolbar } from "./text-toolbar";
import { EditorTopBar } from "./top-bar";

const DESKTOP_QUERY = "(min-width: 1024px)";

function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(DESKTOP_QUERY);
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true,
  );
}

const EMPTY_ASSETS = "";

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="fixed inset-0 z-40 flex flex-col bg-background text-foreground">{children}</div>;
}

/** Full-screen, three-pane template builder (Settings → Documents → template). */
export function TemplateEditorPage({ templateId }: { templateId: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { can, isLoading: permsLoading } = usePermissions();
  const canView = can("document_templates", "view");
  const canEdit = can("document_templates", "edit");
  const isDesktop = useIsDesktop();

  const query = useDocumentTemplate(templateId, canView, { fresh: true });
  const loaded = useEditorStore((s) => s.templateId === templateId && !!s.draft);
  const kind = useEditorStore((s) => s.draft?.kind ?? "invoice");
  const mode = useEditorUi((s) => s.mode);
  const dirty = useEditorStore(selectIsDirty);
  const save = useSaveTemplate(templateId);
  const [conflict, setConflict] = useState(false);
  const [errors, setErrors] = useState<string[] | null>(null);

  // Load once the fresh copy arrives (or the cached one if the refetch failed).
  const ready = !!query.data && (query.isFetchedAfterMount || !query.isFetching);
  useEffect(() => {
    if (ready && query.data && useEditorStore.getState().templateId !== templateId) {
      useEditorStore.getState().load(query.data);
    }
  }, [ready, query.data, templateId]);

  useEffect(
    () => () => {
      useEditorStore.getState().reset();
      useEditorUi.getState().reset();
    },
    [],
  );

  // The builder covers the app; stop the page behind it from scrolling.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const { data: profile } = useBusinessProfile();
  const assetIdsKey = useEditorStore((s) => (s.draft ? collectAssetIds(s.draft.content).join("\n") : EMPTY_ASSETS));
  const assets = useAssetUrls(assetIdsKey ? assetIdsKey.split("\n") : []);
  const ctx = useSampleContext(kind, profile, assets);

  const doSave = useCallback(
    async (overwrite = false) => {
      const s = useEditorStore.getState();
      if (!s.draft || !canEdit || save.isPending) return;
      if (!overwrite && !selectIsDirty(s)) return;
      const name = templateNameSchema.safeParse(s.draft.name);
      if (!name.success) {
        toast.error(name.error.issues[0]?.message ?? "Check the template name");
        return;
      }
      const valid = validateTemplateContent(s.draft.content);
      if (!valid.ok) {
        setErrors(valid.errors);
        return;
      }
      const snapshot = s.draft;
      let version = s.version;
      if (overwrite) {
        try {
          version = (await getTemplate(templateId)).version;
        } catch (e) {
          toast.error(getApiErrorMessage(e, "Couldn't load the latest version"));
          return;
        }
      }
      const { page, header, body, footer, visibility } = valid.value;
      save.mutate(
        {
          name: name.data,
          autoApply: kindHasDefault(snapshot.kind) ? snapshot.autoApply : undefined,
          page,
          header,
          body,
          footer,
          visibility,
          version,
        },
        {
          onSuccess: (t) => {
            useEditorStore.getState().markSaved(t.version, snapshot);
            setConflict(false);
            toast.success("Template saved");
          },
          onError: (e) => {
            if (isVersionConflict(e)) setConflict(true);
          },
        },
      );
    },
    [canEdit, save, templateId],
  );

  const reloadLatest = async () => {
    try {
      const t = await qc.fetchQuery({
        queryKey: queryKeys.documentTemplates.detail(templateId),
        queryFn: () => getTemplate(templateId),
        staleTime: 0,
      });
      useEditorStore.getState().load(t);
      setConflict(false);
      toast.success("Loaded the latest version");
    } catch (e) {
      toast.error(getApiErrorMessage(e, "Couldn't reload the template"));
    }
  };

  const onSave = useCallback(() => void doSave(), [doSave]);
  useEditorShortcuts({ onSave, enabled: loaded && canEdit });
  useLeaveGuard(dirty && loaded);

  const goBack = () => {
    if (useEditorStore.getState().draft && selectIsDirty(useEditorStore.getState()) && !window.confirm(LEAVE_MESSAGE)) return;
    router.push("/settings/documents");
  };

  /* ------------------------------------------------------------- states */

  if (!permsLoading && !canView) {
    return (
      <Shell>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <h2 className="text-lg font-medium">No access</h2>
          <p className="text-sm text-muted-foreground">You don&apos;t have permission to view document templates.</p>
          <Button variant="outline" size="sm" onClick={() => router.push("/settings")}>
            Back to settings
          </Button>
        </div>
      </Shell>
    );
  }

  if (query.isError && !query.data) {
    return (
      <Shell>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <AlertCircle className="size-6 text-destructive" />
          <p className="text-sm">{getApiErrorMessage(query.error, "Couldn't load this template")}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => query.refetch()}>
              Try again
            </Button>
            <Button variant="ghost" size="sm" onClick={() => router.push("/settings/documents")}>
              Back to templates
            </Button>
          </div>
        </div>
      </Shell>
    );
  }

  if (!loaded) {
    return (
      <Shell>
        <div className="flex h-14 items-center gap-3 border-b px-3">
          <Skeleton className="size-8" />
          <Skeleton className="h-5 w-48" />
          <Loader2 className="ml-auto size-4 animate-spin text-muted-foreground" />
        </div>
        <div className="flex min-h-0 flex-1">
          <Skeleton className="hidden h-full w-[300px] rounded-none lg:block" />
          <div className="flex flex-1 justify-center bg-muted p-6">
            <Skeleton className="aspect-[8.5/11] h-full max-w-full bg-background" />
          </div>
          <Skeleton className="hidden h-full w-[300px] rounded-none lg:block" />
        </div>
      </Shell>
    );
  }

  const compact = !isDesktop || !canEdit;
  const topBar = (
    <EditorTopBar
      canEdit={canEdit}
      compact={compact}
      isDefault={!!query.data?.isDefault}
      saving={save.isPending}
      ctx={ctx}
      onBack={goBack}
      onSave={onSave}
    />
  );

  const dialogs = (
    <>
      <AlertDialog open={conflict} onOpenChange={setConflict}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>This template was changed elsewhere</AlertDialogTitle>
            <AlertDialogDescription>
              Someone saved a newer version while you were editing. Load their version (your changes are discarded) or
              overwrite it with yours.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <Button variant="outline" onClick={() => void reloadLatest()}>
              Load latest
            </Button>
            <AlertDialogAction variant="destructive" onClick={() => void doSave(true)}>
              Overwrite
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!errors} onOpenChange={(o) => !o && setErrors(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>The template can&apos;t be saved yet</AlertDialogTitle>
            <AlertDialogDescription>Fix these problems and save again:</AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-60 list-disc space-y-1 overflow-y-auto pl-5 text-sm">
            {(errors ?? []).slice(0, 20).map((e) => (
              <li key={e} className="break-words">
                {e}
              </li>
            ))}
            {(errors?.length ?? 0) > 20 ? <li>…and {errors!.length - 20} more</li> : null}
          </ul>
          <AlertDialogFooter>
            <AlertDialogAction>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  if (compact) {
    return (
      <Shell>
        {topBar}
        <div className="flex items-start gap-2 border-b bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:bg-amber-400/10 dark:text-amber-200">
          {canEdit ? <MonitorSmartphone className="mt-0.5 size-4 flex-none" /> : <MousePointerClick className="mt-0.5 size-4 flex-none" />}
          <p>
            {canEdit
              ? "The template editor needs a larger screen (at least 1024px wide). You can rename the template and preview it here."
              : "You can view this template but not change it."}
          </p>
        </div>
        <div className="min-h-0 flex-1 bg-muted">
          <LivePreview ctx={ctx} interactive={false} />
        </div>
        {dialogs}
      </Shell>
    );
  }

  return (
    <Shell>
      {topBar}
      <EditorDnd>
        <div className="flex min-h-0 flex-1">
          <aside className="w-[300px] flex-none border-r bg-background" aria-label="Design tools">
            <LeftPanel />
          </aside>
          <main className="flex min-w-0 flex-1 flex-col bg-muted" aria-label="Template page">
            {mode === "edit" ? (
              <TextToolbar />
            ) : (
              <div className="flex h-11 flex-none items-center gap-2 border-b bg-background px-3 text-xs text-muted-foreground">
                <MousePointerClick className="size-4" /> Live preview — click a block to edit it.
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-auto">
              {mode === "edit" ? <TemplateCanvas ctx={ctx} /> : <LivePreview ctx={ctx} />}
            </div>
          </main>
          <aside className="w-[300px] flex-none border-l bg-background" aria-label="Properties">
            <PropertiesPanel />
          </aside>
        </div>
      </EditorDnd>
      {dialogs}
    </Shell>
  );
}
