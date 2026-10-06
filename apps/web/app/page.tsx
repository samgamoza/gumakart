import { getActiveLanding } from "@gumakart/db";
import { Frontend1Landing } from "@/components/marketing/Frontend1Landing";
import { Frontend2Landing } from "@/components/marketing/Frontend2Landing";
import { Frontend3Landing } from "@/components/marketing/Frontend3Landing";

// Which landing the public sees is controlled by the super-admin "active_landing"
// platform setting (Platform admin → Frontends). Read per request so the toggle
// takes effect immediately.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const active = await getActiveLanding();
  if (active === "frontend3") return <Frontend3Landing />;
  return active === "frontend2" ? <Frontend2Landing /> : <Frontend1Landing />;
}
