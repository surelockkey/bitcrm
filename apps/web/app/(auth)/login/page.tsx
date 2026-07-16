import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/features/auth/components/login-form";

export default function LoginPage() {
  return (
    <AuthShell
      title="Sign in to your account"
      subtitle="Operations platform for the field"
    >
      <LoginForm />
    </AuthShell>
  );
}
