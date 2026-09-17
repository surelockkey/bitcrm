"use client";

import { useState } from "react";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api/errors";

/**
 * Open a freshly signed PDF in a new tab. The tab is opened synchronously
 * (still inside the click) so popup blockers — Safari especially — allow it,
 * then pointed at the URL once the API returns it.
 */
export async function openPdfInNewTab(getUrl: () => Promise<{ url: string }>): Promise<void> {
  const tab = window.open("", "_blank");
  try {
    const { url } = await getUrl();
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
    } else {
      window.location.assign(url);
    }
  } catch (e) {
    tab?.close();
    throw e;
  }
}

/** Click handler + pending flag around {@link openPdfInNewTab}. */
export function useOpenPdf(getUrl: () => Promise<{ url: string }>) {
  const [pending, setPending] = useState(false);
  const open = () => {
    setPending(true);
    openPdfInNewTab(getUrl)
      .catch((e) => toast.error(getApiErrorMessage(e, "Couldn't generate the PDF")))
      .finally(() => setPending(false));
  };
  return { open, pending };
}
