import Link from 'next/link';
import { articlePath, localeNames, readerLocales, type ReaderLocale } from './content';

export const LanguageSwitch = ({
  locale,
  documentId,
}: {
  locale: ReaderLocale;
  documentId?: string;
}) => (
  <nav aria-label="Language" className="languages">
    {readerLocales.map((language) => (
      <Link
        key={language}
        href={documentId ? articlePath(language, documentId) : `/${language}`}
        lang={language}
        hrefLang={language}
        aria-current={locale === language ? 'page' : undefined}
      >
        {localeNames[language]}
      </Link>
    ))}
  </nav>
);
