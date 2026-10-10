import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isReaderLocale } from '../../lib/content';
import '../styles.css';

export const metadata: Metadata = {
  title: { default: 'Margin | Field notes', template: '%s | Margin' },
  description: 'Stories from the places between destinations.',
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
          <Link className="wordmark" href={`/${locale}`}>
            margin<span className="wordmark-dot">.</span>
          </Link>
          <span className="masthead-note">A journal of close attention</span>
          <span className="issue">Vol. 01 / The coast</span>
        </header>
        {children}
        <footer className="footer">
          <Link href={`/${locale}`}>margin.</Link>
          <p>Stories from the places between destinations.</p>
          <span>Made for a slower read.</span>
        </footer>
      </body>
    </html>
  );
}
