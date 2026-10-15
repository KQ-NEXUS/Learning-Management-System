import Image from "next/image";
import { BRAND } from "@/lib/brand";

/** The IETC shield, decorative; the adjacent wordmark provides its accessible name. */
export function BrandMark({ className = "h-[26px] w-auto" }: { className?: string }) {
  return (
    <Image
      src={BRAND.logo.src}
      width={BRAND.logo.width}
      height={BRAND.logo.height}
      alt=""
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    />
  );
}
