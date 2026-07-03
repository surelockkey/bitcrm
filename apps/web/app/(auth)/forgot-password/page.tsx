import { AuthShell } from "@/components/auth/auth-shell";
import { BackToSignIn } from "@/components/auth/back-to-sign-in";
import { ForgotForm } from "@/features/auth/components/forgot-form";

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter the email on your account and we'll send a 6-digit reset code."
      footer={<BackToSignIn />}
    >
      <ForgotForm />
    </AuthShell>
  );
}
