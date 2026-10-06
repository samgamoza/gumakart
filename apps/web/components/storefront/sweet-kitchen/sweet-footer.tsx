
import { sizedImageUrl } from "@/lib/image-sizes";import type { DemoTenant } from "@/lib/demo-data";

export function SweetFooter({ tenant }: { tenant: DemoTenant }) {
  const accent = tenant.shopTheme.primaryColor;

  return (
    <footer className="bg-[#1a1012] px-6 py-16 text-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 md:flex-row md:justify-between">
        <div>
          {tenant.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={sizedImageUrl(tenant.logoUrl, 80)}
              loading="lazy"
              decoding="async"
              alt={tenant.name}
              className="mb-4 h-20 w-auto rounded-full"
            />
          ) : (
            <p className="font-display mb-2 text-3xl">{tenant.name}</p>
          )}
          <p className="max-w-xs text-sm text-white/40">{tenant.tagline}</p>
        </div>
        <div className="text-sm text-white/40">
          <p className="mb-2 font-medium text-white/70">Made with love</p>
          <p>{tenant.category} · {tenant.location}</p>
          <p className="mt-4 text-xs">
            &copy; {new Date().getFullYear()} {tenant.name}. Powered by{" "}
            <span style={{ color: accent }}>Guma One</span>.
          </p>
        </div>
      </div>
    </footer>
  );
}
