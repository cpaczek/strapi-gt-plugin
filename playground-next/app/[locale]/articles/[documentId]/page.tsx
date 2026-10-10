import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Blocks, Markdown } from '../../../../lib/blocks';
import { articlePath, isReaderLocale, localeNames, readerLocales } from '../../../../lib/content';
import { LanguageSwitch } from '../../../../lib/language-switch';
import { contentReader, mediaUrl } from '../../../../lib/strapi';

type ArticleProps = { params: Promise<{ locale: string; documentId: string }> };
export async function generateMetadata({ params }: ArticleProps): Promise<Metadata> {
  const { locale, documentId } = await params;
  if (!isReaderLocale(locale)) return {};
  const article = await contentReader.get(documentId, locale);
  return { title: article?.title ?? 'Story unavailable', description: article?.summary };
}
export default async function ArticlePage({ params }: ArticleProps) {
  const { locale, documentId } = await params;
  if (!isReaderLocale(locale)) notFound();
  const article = await contentReader.get(documentId, locale);
  if (!article) {
    const alternatives = await Promise.all(
      readerLocales
        .filter((language) => language !== locale)
        .map(async (language) => ({
          language,
          article: await contentReader.get(documentId, language),
        }))
    );
    const available = alternatives.find((entry) => entry.article !== null);
    if (!available) notFound();
    return (
      <main id="main" className="article-page">
        <div className="edition-row">
          <Link href={`/${locale}`}>All stories</Link>
          <LanguageSwitch locale={locale} documentId={documentId} />
        </div>
        <section className="empty">
          <h1>This story is not available in this language.</h1>
          <p>A translation will appear here after the editors publish it.</p>
          <Link href={articlePath(available.language, documentId)}>
            Read in {localeNames[available.language]}
          </Link>
        </section>
      </main>
    );
  }
  return (
    <main id="main" className="article-page">
      <div className="edition-row">
        <Link href={`/${locale}`}>All stories</Link>
        <LanguageSwitch locale={locale} documentId={documentId} />
      </div>
      <article>
        <header className="article-header">
          <span className="eyebrow">{article.category?.name ?? 'Void dispatch'}</span>
          <h1>{article.title}</h1>
          <p className="standfirst">{article.summary}</p>
          <div className="article-byline">
            <span>By {article.credits[0]?.name ?? 'The editorial void'}</span>
            <span>{article.readingMinutes ?? 5} min read</span>
          </div>
        </header>
        {article.cover && (
          <figure className="cover">
            <Image
              src={mediaUrl(article.cover.url)}
              width={1600}
              height={1000}
              priority
              sizes="100vw"
              alt={article.cover.alternativeText ?? ''}
            />
            {article.cover.caption && <figcaption>{article.cover.caption}</figcaption>}
          </figure>
        )}
        <div className="article-body">
          <Blocks nodes={article.body} />
          {article.sections.map((section, index) => {
            if (section.__component === 'editorial.pull-quote')
              return (
                <blockquote className="pull-quote" key={index}>
                  <p>{section.quote}</p>
                  {section.attribution && <cite>{section.attribution}</cite>}
                </blockquote>
              );
            if (section.__component === 'editorial.text-section')
              return (
                <section key={index}>
                  <h2>{section.heading}</h2>
                  <Blocks nodes={section.body} />
                </section>
              );
            return (
              <section className="gallery" key={index}>
                {section.title && <h2>{section.title}</h2>}
                {section.images.map((image, imageIndex) => (
                  <figure key={imageIndex}>
                    <Image
                      src={mediaUrl(image.url)}
                      width={960}
                      height={600}
                      alt={image.alternativeText ?? ''}
                    />
                    {image.caption && <figcaption>{image.caption}</figcaption>}
                  </figure>
                ))}
              </section>
            );
          })}
          {article.markdown && (
            <section className="field-guide">
              <span className="eyebrow">Recovered from the evidence locker</span>
              <Markdown source={article.markdown} />
            </section>
          )}
        </div>
        {article.glossary.length > 0 && (
          <section className="glossary" aria-labelledby="glossary-heading">
            <div>
              <span className="eyebrow">Know your void</span>
              <h2 id="glossary-heading">
                The unofficial
                <br />
                Ender dictionary.
              </h2>
              <p>{article.editorialNote}</p>
            </div>
            <dl>
              {article.glossary.map((entry) => (
                <div key={entry.term}>
                  <dt>{entry.term}</dt>
                  <dd>{entry.meaning}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
        <div className="credits">
          {article.credits.map((credit, index) => (
            <p key={index}>
              <span>{credit.role}</span>
              {credit.name}
            </p>
          ))}
        </div>
      </article>
    </main>
  );
}
