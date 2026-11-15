import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Header } from "@/components/Header";
import { ConvexClientProvider } from "@/components/providers/ConvexClientProvider";
import { ToastProvider } from "@/components/providers/ToastProvider";
import { ViewerProvider } from "@/components/providers/ViewerProvider";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "LendLoop: Borrow what you need. Lend what you don't.",
  description: "A neighbourhood tool-lending board.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-stone-50 text-stone-900">
        <ClerkProvider>
          <ConvexClientProvider>
            <ViewerProvider>
              <ToastProvider>
                <Header />
                <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
                <footer className="border-t border-stone-200 py-6 text-center text-xs text-stone-500">
                  LendLoop is a demo project. Borrow kindly, return on time.
                </footer>
              </ToastProvider>
            </ViewerProvider>
          </ConvexClientProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
