import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export function BackToSignIn() {
  return (
    <Link
      href="/login"
      className="flex items-center justify-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      Back to sign in
    </Link>
  );
}
