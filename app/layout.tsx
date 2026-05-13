import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Inter, Newsreader, JetBrains_Mono } from 'next/font/google';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { ClerkProvider } from '@clerk/nextjs';
import { ThemeProvider } from '@/components/theme-provider';
import { AmplitudeProvider } from '@/components/amplitude-provider';
import { MotionProvider } from '@/components/motion/motion-provider';
import { Toaster } from 'sonner';
import './globals.css';

// Fonts for the cofounder.co-style canvas system.
// - Inter (sans) is the UI/body workhorse.
// - Newsreader (serif) is the canvas centerpiece + hero serif.
// - JetBrains Mono is for chips, status pills, zoom indicators, eyebrow text.
// All three are loaded via next/font with `display: 'swap'` and exposed as
// CSS variables so Tailwind v4's font-sans / font-serif / font-mono resolve
// to them (see globals.css `@theme inline` block).
const fontSans = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sans-pro',
  display: 'swap',
});

const fontSerif = Newsreader({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-serif',
  display: 'swap',
});

const fontMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono-pro',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Charles — Your AI cofounder',
  description: 'Charles is your AI cofounder — a manager agent that runs an entire company across engineering, sales, marketing, design, support, and Ops/Finance, so a solo founder can ship from idea to revenue without hiring.',
  openGraph: {
    title: 'Charles — Your AI cofounder',
    description: 'A manager agent that runs engineering, sales, marketing, design, support, and Ops/Finance, so a solo founder can ship from idea to revenue.',
    siteName: 'Charles',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Charles — Your AI cofounder',
    description: 'A manager agent that runs engineering, sales, marketing, design, support, and Ops/Finance, so a solo founder can ship from idea to revenue.',
  },
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0f' },
  ],
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default' as const,
    title: 'Charles',
  },
};

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Public-facing pages (intake, booking, status) set this header in
  // middleware so we can skip ClerkProvider entirely — prevents Clerk's
  // client-side JS from loading and prompting visitors to sign in.
  const h = await headers();
  const isPublicPage = h.get('x-public-page') === '1';

  const fontVars = `${fontSans.variable} ${fontSerif.variable} ${fontMono.variable}`;

  const renderShell = (body: React.ReactNode) => (
    <html lang="en" className={fontVars} suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground">
        <ThemeProvider>
          <AmplitudeProvider>
            <MotionProvider>
              {body}
            </MotionProvider>
          </AmplitudeProvider>
        </ThemeProvider>
        <Toaster
          position="top-right"
          theme="system"
          toastOptions={{
            duration: 3500,
            unstyled: true,
            classNames: {
              toast:
                'group pointer-events-auto flex w-full items-start gap-3 rounded-lg border border-border/70 bg-popover p-3.5 text-foreground shadow-lg shadow-foreground/5 transition-all duration-150',
              title: 'text-sm font-medium leading-snug text-foreground',
              description: 'text-[13px] leading-snug text-muted-foreground',
              actionButton:
                'rounded-md bg-foreground px-2.5 py-1 text-[13px] font-medium text-background transition-colors duration-150 hover:bg-foreground/90',
              cancelButton:
                'rounded-md bg-muted px-2.5 py-1 text-[13px] font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted/80',
              closeButton:
                'rounded-md border border-border/70 bg-background text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground',
              success: 'border-l-2 border-l-emerald-500/70',
              error: 'border-l-2 border-l-red-500/70',
              warning: 'border-l-2 border-l-orange-500/70',
              info: 'border-l-2 border-l-sky-500/70',
            },
          }}
        />
        <SpeedInsights />
      </body>
    </html>
  );

  if (isPublicPage) return renderShell(children);
  return <ClerkProvider>{renderShell(children)}</ClerkProvider>;
}
