"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, useMemo } from "react";
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
import { settled, usePageReady } from "@/lib/use-page-ready";
import { useImagesReady } from "@/lib/use-images-ready";
import { useBusinessProfiles } from "@/features/business-profiles/hooks";
import { useAssetUrlsState, useBusinessProfile, useDocumentTemplate, useSampleContext, useSaveTemplate } from "../../hooks";
import { collectAssetIds, isVersionConflict, kindHasDefault } from "../../lib";
import { templateNameSchema } from "../../schemas";
import { selectIsDirty, useEditorStore } from "../store";
import { useEditorUi } from "../ui-store";
import { useEditorShortcuts, useLeaveGuard } from "../use-editor-shortcuts";
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

/**
 * Inside the app shell, as Workiz's designer is (pg_settings_general_wz_doc_invoice):
 * the sidebar and the top bar stay, the editor fills the rest — the settings
 * layout bounds it (`settingsFrame` "editor") so the page and the panels
 * scroll on their own.
 */
function Shell({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-white text-foreground">{children}</div>;
}

/**
 * The template builder (Settings → Documents → template), laid out as
 * Workiz's: the head (name, the row of yellow pills), then under a 1px #ccc
 * rule the page on white at the left and the panels at the right — ours, the
 * selected block's properties, then Workiz's tabbed panel at the edge.
 */
export function TemplateEditorPage({ templateId }: { templateId: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { can, isLoading: permsLoading } = usePermissions();
  const canView = can("document_templates", "view");
  const canEdit = can("document_templates", "edit");
  const isDesktop = useIsDesktop();

  // Asked for at once, not after the permissions: a reader without access is
  // refused once they are known, and everyone else is spared the wait.
  const query = useDocumentTemplate(templateId, permsLoading || canView, { fresh: true });
  const loaded = useEditorStore((s) => s.templateId === templateId && !!s.draft);
  const kind = useEditorStore((s) => s.draft?.kind ?? "invoice");
  const mode = useEditorUi((s) => s.mode);
  const dirty = useEditorStore(selectIsDirty);
  const save = useSaveTemplate(templateId);
  const [conflict, setConflict] = useState(false);
  const [errors, setErrors] = useState<string[] | null>(null);

  // Load once the fresh copy arrives (or the cached one if the refetch failed).
  const fresh = !!query.data && (query.isFetchedAfterMount || !query.isFetching);
  useEffect(() => {
    if (fresh && query.data && useEditorStore.getState().templateId !== templateId) {
      useEditorStore.getState().load(query.data);
    }
  }, [fresh, query.data, templateId]);

  useEffect(
    () => () => {
      useEditorStore.getState().reset();
      useEditorUi.getState().reset();
    },
    [],
  );

  // The builder fills the window; the page behind it must not scroll too.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const { data: profile } = useBusinessProfile();
  const companies = useBusinessProfiles();
  // The pictures the template holds are asked for with the template itself —
  // off the fetched copy until the draft is loaded, off the draft after.
  const draftAssetIds = useEditorStore((s) => (s.draft ? collectAssetIds(s.draft.content).join("\n") : null));
  const assetIdsKey = draftAssetIds ?? (query.data ? collectAssetIds(query.data).join("\n") : EMPTY_ASSETS);
  const assets = useAssetUrlsState(assetIdsKey ? assetIdsKey.split("\n") : []);
  const ctx = useSampleContext(kind, profile, assets.urls);

  // The editor stays behind its skeleton until what the paper prints is in:
  // the company (its logo) and the pictures — their addresses, and then the
  // pictures themselves, since an <img> sized by its own picture has no height
  // until its bytes arrive. They used to land after the editor was up and
  // push the sections about.
  const pictures = useMemo(
    () => [profile?.logoUrl, ...Object.values(assets.urls)].filter((u): u is string => !!u),
    [profile?.logoUrl, assets.urls],
  );
  const picturesIn = useImagesReady(pictures);
  const ready = usePageReady(loaded && settled(companies) && assets.ready && picturesIn);

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

  if (!loaded || !ready) {
    return (
      <Shell>
        <div className="flex flex-none flex-col gap-[15px] px-5 pt-[35px] pb-5">
          <Skeleton className="h-[19px] w-48" />
          <div className="flex items-center gap-4">
            <Skeleton className="h-8 w-[100px] rounded-pill" />
            <Skeleton className="h-8 w-[80px] rounded-pill" />
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        </div>
        <div className="flex min-h-0 flex-1 border-t border-input">
          <div className="flex flex-1 justify-center p-6">
            <Skeleton className="aspect-[8.5/11] h-full max-w-full" />
          </div>
          <Skeleton className="hidden h-full w-[280px] rounded-none border-l border-wz-frame lg:block" />
          <Skeleton className="hidden h-full w-[400px] rounded-none border-l border-wz-frame lg:block" />
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
        {/* Workiz's warning colours (#f7a336), as a 12px line over the page. */}
        <div className="flex items-start gap-2 border-y border-wz-toast-warning bg-white px-5 py-2 text-xs leading-[18px] text-foreground">
          {canEdit ? (
            <MonitorSmartphone className="mt-0.5 size-4 flex-none text-wz-toast-warning" />
          ) : (
            <MousePointerClick className="mt-0.5 size-4 flex-none text-wz-toast-warning" />
          )}
          <p>
            {canEdit
              ? "The template editor needs a larger screen (at least 1024px wide). You can rename the template and preview it here."
              : "You can view this template but not change it."}
          </p>
        </div>
        <div className="min-h-0 flex-1 bg-white">
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
        {/* Workiz's designer: a 1px #ccc rule over it, the page on white, a
            1px #ddd edge before the panels. */}
        <div className="flex min-h-0 flex-1 border-t border-input">
          <main className="flex min-w-0 flex-1 flex-col bg-white" aria-label="Template page">
            {mode === "edit" ? (
              <TextToolbar />
            ) : (
              <div className="flex h-[43px] flex-none items-center gap-2 border-b border-wz-tab-rule bg-white px-5 text-xs text-wz-outline-label">
                <MousePointerClick className="size-4" /> Live preview — click a block to edit it.
              </div>
            )}
            {/* The scrollbar's room is kept from the start: the paper is fitted to
                this width, and a scrollbar appearing under a tall template
                would narrow it and re-fit the paper a frame later. */}
            <div className="min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]">
              {mode === "edit" ? <TemplateCanvas ctx={ctx} /> : <LivePreview ctx={ctx} />}
            </div>
          </main>
          <aside className="w-[280px] flex-none border-l border-wz-frame bg-white" aria-label="Properties">
            <PropertiesPanel />
          </aside>
          <aside className="w-[400px] flex-none border-l border-wz-frame bg-white" aria-label="Design tools">
            <LeftPanel />
          </aside>
        </div>
      </EditorDnd>
      {dialogs}
    </Shell>
  );
}
