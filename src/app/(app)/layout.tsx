import {AppShell} from "@/components/AppShell";
import {RankUp} from "@/components/RankUp";

export default function AppLayout({children}: {children: React.ReactNode}) {
  return (
    <AppShell>
      {children}
      {/* Over everything, because a rank-up is the one thing worth interrupting. */}
      <RankUp />
    </AppShell>
  );
}
