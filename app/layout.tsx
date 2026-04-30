import type { Metadata } from "next";
import { Fragment } from "react";
import { ClerkProvider } from '@clerk/nextjs'
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Operation",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const AuthProvider = publishableKey ? ClerkProvider : Fragment;
  const authProviderProps = publishableKey ? { publishableKey } : {};

  return (
    <AuthProvider {...authProviderProps}>
      <html lang="en">
        <body className="antialiased">
          {children}
        </body>
      </html>
    </AuthProvider>
  );
}
