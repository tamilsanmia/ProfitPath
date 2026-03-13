"use client";

const promoText = "Haven't purchased yet? Use code HELLO & Get 20% OFF now on your first purchase!";

export function AnnouncementBanner() {
  return (
    <div className="group relative h-11 overflow-hidden border-b border-primary/25 bg-gradient-to-r from-indigo-600 via-fuchsia-500 to-sky-500">
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.12),transparent_26%,rgba(255,255,255,0.07)_48%,transparent_72%,rgba(255,255,255,0.12))]" />

      <div className="relative flex h-full items-center overflow-hidden">
        <div className="animate-announcement-marquee group-hover:[animation-play-state:paused] flex min-w-max items-center gap-[220px] whitespace-nowrap text-sm font-semibold text-white">
          <span className="inline-block px-[200px]">{promoText}</span>
          <span className="inline-block px-[200px]" aria-hidden="true">
            {promoText}
          </span>
        </div>
      </div>
    </div>
  );
}
