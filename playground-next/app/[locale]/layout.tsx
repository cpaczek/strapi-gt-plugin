import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isReaderLocale } from '../../lib/content';
import '../styles.css';

export const metadata: Metadata = {
  title: { default: 'The Ender Post | Tall tales. Petty theft.', template: '%s | The Ender Post' },
  description:
    'An unofficial Enderman fan zine. Original stories, questionable advice, and several missing blocks.',
};
export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isReaderLocale(locale)) notFound();
  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <body>
        <a className="skip-link" href="#main">
          Skip to stories
        </a>
        <header className="masthead">
          <Link className="wordmark" dir="ltr" href={`/${locale}`}>
            ender<span className="wordmark-dot">post</span>
          </Link>
          <span className="masthead-note">Unlicensed dispatches from the void</span>
          <span className="issue">Issue 001 / Do not stare</span>
        </header>
        {children}
        <footer className="footer">
          <Link href={`/${locale}`}>ENDER POST</Link>
          <p>
            An unofficial Minecraft fan zine. No affiliation with Mojang, Microsoft, or General
            Translation.
          </p>
          <span>Keep your eyes to yourself.</span>
        </footer>
      </body>
    </html>
  );
}
