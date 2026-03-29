export default function Loading() {
  return (
    <div className="flex h-screen w-full bg-[hsl(221,39%,11%)] overflow-hidden">
      {/* Sidebar skeleton */}
      <div className="w-[72px] shrink-0 h-full bg-[hsl(221,39%,9%)] border-r border-white/5 flex flex-col items-center py-4 gap-4">
        {/* Logo */}
        <div className="w-9 h-9 rounded-lg bg-white/10 animate-pulse" />
        <div className="w-full border-t border-white/5 mt-2" />
        {/* Nav icons */}
        {[...Array(5)].map((_, i) => (
          <div key={i} className="w-9 h-9 rounded-lg bg-white/10 animate-pulse" />
        ))}
        <div className="flex-1" />
        {/* Bottom icons */}
        <div className="w-9 h-9 rounded-full bg-white/10 animate-pulse" />
        <div className="w-9 h-9 rounded-lg bg-white/10 animate-pulse" />
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Announcement banner */}
        <div className="h-8 w-full bg-indigo-600/30 animate-pulse shrink-0" />

        {/* Topbar */}
        <div className="h-14 w-full border-b border-white/5 flex items-center px-6 gap-4 shrink-0">
          <div className="h-4 w-36 rounded bg-white/10 animate-pulse" />
          <div className="flex-1" />
          <div className="h-8 w-8 rounded-full bg-white/10 animate-pulse" />
          <div className="h-8 w-8 rounded-lg bg-white/10 animate-pulse" />
          <div className="h-8 w-24 rounded-lg bg-white/10 animate-pulse" />
        </div>

        {/* Page content */}
        <div className="flex-1 overflow-auto p-6 flex flex-col gap-5">
          {/* Page title */}
          <div className="h-6 w-40 rounded bg-white/10 animate-pulse" />

          {/* Stat cards row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="rounded-xl bg-white/5 border border-white/5 p-5 flex flex-col gap-3 animate-pulse">
                <div className="h-3 w-20 rounded bg-white/10" />
                <div className="h-7 w-28 rounded bg-white/10" />
                <div className="h-3 w-16 rounded bg-white/10" />
              </div>
            ))}
          </div>

          {/* Chart + side panel row */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-8 rounded-xl bg-white/5 border border-white/5 p-5 animate-pulse">
              <div className="h-4 w-32 rounded bg-white/10 mb-4" />
              <div className="h-[200px] rounded-lg bg-white/10" />
            </div>
            <div className="lg:col-span-4 rounded-xl bg-white/5 border border-white/5 p-5 flex flex-col gap-3 animate-pulse">
              <div className="h-4 w-24 rounded bg-white/10" />
              {[...Array(4)].map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-white/10 shrink-0" />
                  <div className="flex flex-col gap-1 flex-1">
                    <div className="h-3 w-full rounded bg-white/10" />
                    <div className="h-3 w-2/3 rounded bg-white/10" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Table skeleton */}
          <div className="rounded-xl bg-white/5 border border-white/5 p-5 animate-pulse">
            <div className="h-4 w-28 rounded bg-white/10 mb-4" />
            <div className="flex gap-4 mb-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-3 flex-1 rounded bg-white/10" />
              ))}
            </div>
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex gap-4 py-2 border-t border-white/5">
                {[...Array(5)].map((_, j) => (
                  <div key={j} className="h-3 flex-1 rounded bg-white/10" />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
