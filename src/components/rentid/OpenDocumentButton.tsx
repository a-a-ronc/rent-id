/**
 * Opens a filed document.
 *
 * Documents live in a private bucket, so there is no durable URL to link to —
 * the row's RLS policy is checked first, then a five-minute signed URL is
 * minted on demand. The tab has to be opened synchronously inside the click
 * handler: a `window.open` after an `await` is treated as a popup and blocked.
 */
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/rentid/kit";
import { getDocumentUrl } from "@/lib/storage";

export function OpenDocumentButton({
  storagePath,
  label = "Open",
  tone = "secondary",
  size = "sm",
}: {
  storagePath: string | null | undefined;
  label?: string;
  tone?: "primary" | "secondary";
  size?: "sm" | "md";
}) {
  const [busy, setBusy] = useState(false);

  async function open() {
    if (!storagePath) {
      toast.info("No file is attached to this record.");
      return;
    }
    const tab = window.open("", "_blank", "noopener,noreferrer");
    setBusy(true);
    try {
      const url = await getDocumentUrl(storagePath);
      if (!url) {
        tab?.close();
        toast.info(
          "This record was filed before its file was uploaded, so there is nothing to open.",
        );
        return;
      }
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (error) {
      tab?.close();
      toast.error(error instanceof Error ? error.message : "The file could not be opened.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button tone={tone} size={size} loading={busy} disabled={busy} onClick={() => void open()}>
      {label}
    </Button>
  );
}
