import type {Metadata} from "next";

import {FeedScreen} from "./FeedScreen";

export const metadata: Metadata = {title: "Feed"};

/** Written to constantly, so it is read per request rather than cached. */
export const dynamic = "force-dynamic";

export default function FeedPage() {
  return <FeedScreen />;
}
