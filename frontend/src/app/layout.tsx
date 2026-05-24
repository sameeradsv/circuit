import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@shared/cortex";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "Circuit",
  description: "Adaptive task planner",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const apiBase =
    (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

  return (
    <html lang="en">
      <head>
        {/* Apply saved theme before paint to avoid flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('circuit_ui_theme');if(t)document.documentElement.setAttribute('data-theme',t)}catch(e){}})()`,
          }}
        />
      </head>
      <body>
        <AuthProvider
          apiBase={apiBase}
          tokenKey="circuit_auth_token"
          authPath="/api/auth"
        >
          <Nav />
          <main className="mx-auto max-w-4xl px-4 py-8">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
