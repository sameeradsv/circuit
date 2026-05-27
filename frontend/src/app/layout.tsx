import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@shared/cortex";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "Circuit",
  description: "Adaptive task planner",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const apiBase = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

  return (
    <html lang="en">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var p=localStorage.getItem('circuit_palette');document.documentElement.setAttribute('data-palette',p||'paper')}catch(e){}})()`,
          }}
        />
      </head>
      <body>
        <AuthProvider
          apiBase={apiBase}
          tokenKey="circuit_auth_token"
          authPath="/api/auth"
        >
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
