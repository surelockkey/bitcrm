import { AuthShell } from "@/components/auth/auth-shell";
import { SetPasswordForm } from "@/features/auth/components/set-password-form";

export default function SetPasswordPage() {
  return (
    <AuthShell
      title="Set a new password"
      subtitle="First sign-in requires a new password to finish setup"
    >
      <SetPasswordForm />
    </AuthShell>
  );
}
