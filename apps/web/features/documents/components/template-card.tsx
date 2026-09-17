"use client";

import { memo } from "react";
import Link from "next/link";
import { Copy, MoreHorizontal, Pencil, Star, Trash2, Zap } from "lucide-react";
import type { DocumentTemplateSummary } from "@bitcrm/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { collectAssetIds, kindHasDefault } from "../lib";
import { useAssetUrls, useBusinessProfile, useDocumentTemplate, useSampleContext } from "../hooks";
import { DocumentThumbnail, useInView } from "./document-thumbnail";

interface Props {
  template: DocumentTemplateSummary;
  autoApply: string | null;
  canEdit: boolean;
  onDuplicate: (t: DocumentTemplateSummary) => void;
  onSetDefault: (t: DocumentTemplateSummary) => void;
  onDelete: (t: DocumentTemplateSummary) => void;
}

function CardThumbnail({ template }: { template: DocumentTemplateSummary }) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const { data } = useDocumentTemplate(template.id, inView);
  const { data: profile } = useBusinessProfile();
  const assets = useAssetUrls(collectAssetIds(data));
  const ctx = useSampleContext(template.kind, profile, assets);
  return (
    <div ref={ref}>
      <DocumentThumbnail content={data} ctx={ctx} title={`${template.name} preview`} />
    </div>
  );
}

export const TemplateCard = memo(function TemplateCard({ template, autoApply, canEdit, onDuplicate, onSetDefault, onDelete }: Props) {
  const href = `/settings/documents/${template.id}`;
  return (
    <article className="group flex flex-col overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md">
      <Link
        href={href}
        className="block border-b bg-muted/40 p-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label={`${canEdit ? "Edit" : "Open"} ${template.name}`}
      >
        <div className="mx-auto max-w-[220px] overflow-hidden rounded-sm shadow-sm ring-1 ring-black/5 transition-transform group-hover:-translate-y-0.5">
          <CardThumbnail template={template} />
        </div>
      </Link>
      <div className="flex items-start gap-2 p-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-1.5">
            <Link href={href} className="truncate text-sm font-medium hover:underline">
              {template.name}
            </Link>
            {template.isDefault ? (
              <Badge variant="secondary" className="h-5 gap-1 px-1.5 text-[10px]">
                <Star className="size-3" /> Default
              </Badge>
            ) : null}
          </div>
          {autoApply ? (
            <p className="flex items-start gap-1 text-xs text-muted-foreground">
              <Zap className="mt-0.5 size-3 flex-none" />
              <span className="line-clamp-2">{autoApply}</span>
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">Updated {new Date(template.updatedAt).toLocaleDateString()}</p>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${template.name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem asChild>
              <Link href={href}>
                <Pencil /> {canEdit ? "Edit" : "Open"}
              </Link>
            </DropdownMenuItem>
            {canEdit ? (
              <>
                <DropdownMenuItem onSelect={() => onDuplicate(template)}>
                  <Copy /> Duplicate
                </DropdownMenuItem>
                {kindHasDefault(template.kind) && !template.isDefault ? (
                  <DropdownMenuItem onSelect={() => onSetDefault(template)}>
                    <Star /> Set as default
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  disabled={template.isDefault}
                  onSelect={() => onDelete(template)}
                  title={template.isDefault ? "Make another template the default first" : undefined}
                >
                  <Trash2 /> Delete
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  );
});
