import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata = { title: "Forgot your password?" };

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <ForgotPasswordForm />
    </main>
  );
}
