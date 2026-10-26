import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/inter';
import '@fontsource-variable/cormorant-garamond';
import './globals.css';

// U11: link previews carry no request details, and nothing is indexed.
export const metadata: Metadata = {
  title: 'Lute: private payments on Zcash',
  description: 'Get paid privately with a link. Checkout, subscriptions, split bills and streams on Zcash shielded payments.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f5f1' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0b' },
  ],
};

// Applies the saved theme before the first paint (no flash). "system" leaves it to the OS.
const THEME_BOOT = `try{var t=localStorage.getItem('lute-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
