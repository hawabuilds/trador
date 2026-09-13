import {ProfileScreen} from "./ProfileScreen";

export const dynamic = "force-dynamic";

export function generateMetadata({params}: {params: {handle: string}}) {
  return {title: `@${params.handle}`};
}

export default function ProfilePage({params}: {params: {handle: string}}) {
  return <ProfileScreen handle={params.handle} />;
}
