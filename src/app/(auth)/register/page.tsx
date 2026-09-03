import { RegisterForm } from "./RegisterForm";

export const metadata = { title: "Create account" };

export default function RegisterPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <RegisterForm />
    </main>
  );
}
