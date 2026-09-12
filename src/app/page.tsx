import {LoginScreen} from "@/components/LoginScreen";
import {snapshotStonks} from "@/lib/server/snapshot";
import {STOCK_MINTS} from "@/lib/stocks/registry";

export default function LandingPage() {
  const stonks = snapshotStonks().items;

  return (
    <LoginScreen
      stonkCount={stonks.length}
      stockCount={new Set(stonks.map((stonk) => stonk.quoteTicker)).size}
      verifiedCount={STOCK_MINTS.length}
    />
  );
}
