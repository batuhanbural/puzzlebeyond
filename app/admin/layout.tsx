import type { Metadata } from "next";
import "./admin.css";

export const metadata: Metadata = {
  title: "Yönetim | puzzlebeyond",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
