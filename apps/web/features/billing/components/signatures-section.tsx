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
 */
export function SignaturesSection({
  signatures,
  signerName,
  canSign,
  onSign,
  saving,
}: {
  signatures: DocumentSignatureView[];
  /** Pre-filled "Signed by": the client's name. */
  signerName: string;
  canSign: boolean;
  onSign: (input: { imageDataUrl: string; signedBy: string }) => Promise<unknown> | void;
  saving?: boolean;
}) {
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

  return (
    <section className="space-y-2 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <PenLine className="size-4 text-muted-foreground" aria-hidden /> Signatures
        </h3>
        {canSign ? (
          <Button variant="brand" size="sm" onClick={openSign}>
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
    </section>
  );
}
