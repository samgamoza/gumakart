import { notFound } from "next/navigation";
import { getStorefrontTenant } from "@/lib/get-storefront-tenant";
import { ShopShell } from "@/components/storefront/shop-shell";
import { SavedItems } from "@/components/saved-items";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ tenantSlug: string }>;
}

/** Phase 22: the buyer's saved items at this shop. */
export default async function SavedPage({ params }: PageProps) {
  const { tenantSlug } = await params;
  const tenant = await getStorefrontTenant(tenantSlug);
  if (!tenant) notFound();
  return (
    <ShopShell tenant={tenant}>
      <section className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="font-display text-3xl font-bold">Saved items</h1>
        <div className="mt-6">
          <SavedItems tenantSlug={tenantSlug} products={tenant.products} />
        </div>
      </section>
    </ShopShell>
  );
}

export async function generateMetadata({ params }: PageProps) {
  const { tenantSlug } = await params;
  const tenant = await getStorefrontTenant(tenantSlug);
  return tenant ? { title: `Saved — ${tenant.name}`, robots: { index: false } } : {};
}
