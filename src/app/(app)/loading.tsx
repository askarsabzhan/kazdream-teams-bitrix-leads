export default function Loading() {
  return (
    <div className="animate-pulse space-y-5" aria-label="Loading">
      <div className="h-9 w-56 rounded-lg bg-zinc-800" />
      <div className="h-28 rounded-2xl border border-zinc-800 bg-zinc-900" />
      <div className="h-72 rounded-2xl border border-zinc-800 bg-zinc-900" />
    </div>
  );
}
