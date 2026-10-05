"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useToast } from "./Toaster";
import { FLASH_PARAM, flashMessage } from "@/lib/flash-notices";

/**
 * Shows the confirmation for an action that ended in a redirect.
 *
 * "Create course" saves and then sends the browser to the new course's page,
 * so the screen that did the work is gone by the time there is something to
 * say. The server action adds `?done=<code>` to the address it redirects to;
 * this reads the code once the new page is up, shows the message for it, and
 * removes the parameter so a reload or a shared link does not repeat it.
 *
 * Only a code from the fixed list in `@/lib/flash-notices` produces a message.
 * Text is never taken from the address itself, so a crafted link cannot make
 * the app display words of the sender's choosing.
 */
export function FlashNotice() {
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const code = searchParams.get(FLASH_PARAM);

  useEffect(() => {
    if (!code) return;
    const message = flashMessage(code);
    if (message) toast.success(message);

    const rest = new URLSearchParams(searchParams.toString());
    rest.delete(FLASH_PARAM);
    const query = rest.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [code, pathname, router, searchParams, toast]);

  return null;
}
