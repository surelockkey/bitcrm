import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Auth form card with the generous (32px) padding used across the sign-in
 * screens. `--card-spacing` drives both the card's vertical and the content's
 * horizontal padding.
 */
export function AuthCard({ children }: { children: ReactNode }) {
  return (
    <Card className="[--card-spacing:--spacing(8)]">
      <CardContent>{children}</CardContent>
    </Card>
  );
}
