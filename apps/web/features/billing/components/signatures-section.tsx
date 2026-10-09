"use client";

import { useState } from "react";
import { Loader2, PenLine } from "lucide-react";
import type { DocumentSignatureView } from "@bitcrm/types";
import { SignaturePad } from "@bitcrm/portal-ui";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WzButton } from "@/components/workiz/button";
import { WzDocSectionHead } from "@/components/workiz/document-parts";
import { cn } from "@/lib/utils";

const SOURCE_LABEL = { portal: "Client portal", app: "In person" } as const;

function formatSignedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * Workiz "Signatures": every signature the document collected — on the
 * client portal (approving an estimate, signing an invoice before paying) or
 * in person — and "Sign" to take one here, the way the technician's phone does.
 *
 * `band` drops the section's own frame for a page that sets it in a card of
 * its own: the grey band, a plain heading, a white Sign like the band's selects.
 * `workiz` is Workiz's own section on a document page (pg_estimate_wz_01_job):
 * its head and yellow Sign, "No signatures found", a Signature / Signed by /
 * Signed table.
 */
export function SignaturesSection({
  signatures,
  signerName,
  canSign,
  onSign,
  saving,
  variant = "card",
}: {
  signatures: DocumentSignatureView[];
  /** Pre-filled "Signed by": the client's name. */
  signerName: string;
  canSign: boolean;
  onSign: (input: { imageDataUrl: string; signedBy: string }) => Promise<unknown> | void;
  saving?: boolean;
  variant?: "card" | "band" | "workiz";
}) {
  const band = variant === "band";
  const [signing, setSigning] = useState(false);
  const [name, setName] = useState(signerName);
  const [image, setImage] = useState<string | null>(null);

  const openSign = () => {
    setName(signerName);
    setImage(null);
    setSigning(true);
  };
  const save = async () => {
    if (!image || !name.trim()) return;
    await onSign({ imageDataUrl: image, signedBy: name.trim() });
    setSigning(false);
  };

  const dialog = (
    <Dialog open={signing} onOpenChange={(o) => !saving && setSigning(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Collect a signature</DialogTitle>
          <DialogDescription>Check the signer&apos;s name belongs to the person signing, then let them sign below.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="signature-name">Signer</Label>
            <Input id="signature-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </div>
          <SignaturePad onChange={setImage} disabled={saving} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setSigning(false)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="brand" onClick={save} disabled={!image || !name.trim() || saving}>
            {saving ? <Loader2 className="animate-spin" /> : null} Save signature
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (variant === "workiz") {
    // pg_estimate_wz_01_job (`signatures-module`): the head over a #cad3d6 rule
    // (6px under, 13px before the list), the yellow Sign, a 13px table.
    return (
      <section aria-label="Signatures" className="text-[13px] text-foreground">
        <WzDocSectionHead
          title="Signatures"
          icon={<PenLine strokeWidth={1.25} />}
          className="mb-[13px] items-end"
          action={
            canSign ? (
              <WzButton size="regular" icon={<PenLine strokeWidth={1.5} />} onClick={openSign}>
                Sign
              </WzButton>
            ) : null
          }
        />
        {signatures.length === 0 ? (
          <p className="text-[13px] leading-4 font-medium">No signatures found</p>
        ) : (
          <table className="mt-[5px] w-full">
            <thead className="border-b border-wz-rule">
              <tr>
                {["Signature", "Signed by", "Signed"].map((h) => (
                  <th key={h} className="p-2.5 text-left align-middle text-[13px] font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {signatures.map((s, i) => (
                <tr key={s.id}>
                  <td className={cn("w-[150px] py-[18px] pr-0.5 pl-2.5 align-middle", i > 0 && "border-t border-dashed border-foreground")}>
                    {s.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a presigned S3 URL, not a static asset
                      <img src={s.imageUrl} alt={`Signature by ${s.signedBy}`} className="max-h-12 max-w-[100px] object-contain" />
                    ) : null}
                  </td>
                  <td className={cn("max-w-[150px] py-[18px] pr-0.5 pl-2.5 align-middle", i > 0 && "border-t border-dashed border-foreground")}>
                    {s.signedBy}
                  </td>
                  <td className={cn("min-w-[200px] py-[18px] pr-0.5 pl-2.5 align-middle", i > 0 && "border-t border-dashed border-foreground")}>
                    {formatSignedAt(s.signedAt)} · {SOURCE_LABEL[s.source] ?? s.source}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {dialog}
      </section>
    );
  }

  return (
    <section className={cn("space-y-2 p-4", band ? "h-full bg-muted/60" : "rounded-lg border")}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          {band ? null : <PenLine className="size-4 text-muted-foreground" aria-hidden />} Signatures
        </h3>
        {canSign ? (
          <Button
            variant={band ? "outline" : "brand"}
            size="sm"
            className={band ? "-my-1.5 h-8 rounded-md bg-card px-3 font-medium [&_svg]:text-muted-foreground" : undefined}
            onClick={openSign}
          >
            <PenLine /> Sign
          </Button>
        ) : null}
      </div>
      {signatures.length === 0 ? (
        <p className="text-sm text-muted-foreground">No signatures yet.</p>
      ) : (
        <ul className="divide-y">
          {signatures.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-2">
              {s.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- a presigned S3 URL, not a static asset
                <img src={s.imageUrl} alt={`Signature by ${s.signedBy}`} className="h-10 w-28 rounded border bg-white object-contain" />
              ) : (
                <span className="h-10 w-28 rounded border bg-muted" aria-hidden />
              )}
              <div className="min-w-0 text-sm">
                <p className="font-medium">{s.signedBy}</p>
                <p className="text-xs text-muted-foreground">
                  {formatSignedAt(s.signedAt)} · {SOURCE_LABEL[s.source] ?? s.source}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {dialog}
    </section>
  );
}
