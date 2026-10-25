import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="space-y-10" aria-busy="true" aria-label="Loading">
      <div className="space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-9 w-64" /></div>
      <div className="grid md:grid-cols-[1.4fr_1fr] gap-4"><Skeleton className="h-[220px] rounded-[24px]" /><Skeleton className="h-[220px] rounded-[24px]" /></div>
      <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[72px]" />)}</div>
    </div>
  );
}
