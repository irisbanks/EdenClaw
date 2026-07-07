import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import ServiceWorkerCleanup from "@/components/ServiceWorkerCleanup";
import { UserProvider } from "@/components/UserProvider";
import AppHeader from "@/components/AppHeader";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "EdenClaw · Dual-Shield 정산 플랫폼",
  description: "대리점 무한 계보도 · Dual-Shield 보상 원장 · 토큰 오버드래프트 정산망",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <ServiceWorkerCleanup />
        <UserProvider>
          <AppHeader />
          {children}
        </UserProvider>
      </body>
    </html>
  );
}
