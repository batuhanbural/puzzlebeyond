import type { Metadata } from "next";
import "./globals.css";

function siteUrl() {
  const configuredUrl = process.env.SITE_URL?.trim();
  const vercelProductionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const rawUrl = configuredUrl || (vercelProductionHost ? `https://${vercelProductionHost}` : "http://localhost:3000");
  const url = new URL(rawUrl);
  const localHost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.username || url.password) throw new Error("SITE_URL kullanıcı bilgisi içeremez.");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && localHost)) {
    throw new Error("SITE_URL HTTPS kullanmalı; yalnızca yerel geliştirmede HTTP kullanılabilir.");
  }
  return new URL(url.origin);
}

const title = "puzzlebeyond — Birlikte puzzle çöz";
const description = "Fotoğrafından puzzle oluştur, oda kodunu paylaş ve arkadaşlarınla aynı puzzle'ı birlikte tamamla.";

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title,
  description,
  alternates: { canonical: "/" },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title,
    description,
    url: "/",
    siteName: "puzzlebeyond",
    type: "website",
    locale: "tr_TR",
    images: [{ url: "/og.jpg", width: 1200, height: 630, alt: "puzzlebeyond — Birlikte daha kolay" }],
  },
  twitter: { card: "summary_large_image", title, description, images: ["/og.jpg"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="tr"><body>{children}</body></html>;
}
