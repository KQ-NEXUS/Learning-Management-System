import { redirect } from "next/navigation";
import { getCurrentActor } from "@/server/auth/current-actor";
import { profileService } from "@/server/services/profile-service";
import { ProfileForm } from "./ProfileForm";

export const metadata = { title: "Your account" };

export default async function AccountPage() {
  const actor = await getCurrentActor();
  if (!actor) redirect("/signin");

  const profile = await profileService.getOwnProfile(actor);
  if (!profile) redirect("/signin");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-[25px] font-semibold tracking-[-0.02em] text-foreground">
          Your account
        </h1>
        <p className="text-sm text-muted-foreground">
          Details, sign-in and communication preferences.
        </p>
      </div>
      <ProfileForm
        name={profile.name}
        phone={profile.phone}
        email={profile.email}
        pendingEmail={profile.pendingEmail}
        marketingOptIn={profile.marketingOptIn}
      />
    </div>
  );
}
