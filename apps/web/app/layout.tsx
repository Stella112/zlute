import type { Metadata } from 'next';
import '@fontsource-variable/inter';
import './globals.css';

// U11: link previews carry no request details, and nothing is indexed.
export const metadata: Metadata = {
  title: 'Lute',
  description: 'Private payments on Zcash',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
