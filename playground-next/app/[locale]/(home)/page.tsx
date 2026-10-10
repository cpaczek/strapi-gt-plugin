import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { articlePath, isReaderLocale } from '../../../lib/content';
import { FeaturePlayground } from '../../../lib/feature-playground';
import { LanguageSwitch } from '../../../lib/language-switch';
import { contentReader, mediaUrl } from '../../../lib/strapi';

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isReaderLocale(locale)) notFound();
  const articles = await contentReader.list(locale);
  return (
    <main id="main" className="home">
      <div className="edition-row">
        <span>The void has a newsletter now</span>
        <LanguageSwitch locale={locale} />
      </div>
      <div className="intro">
        <span className="eyebrow">Three blocks tall. Zero chill.</span>
        <h1>
          Tall tales.
          <br />
          Petty theft.
        </h1>
        <p>
          Fan fiction, stare crimes, and the ongoing custody battle over one very ordinary dirt
          block.
        </p>
      </div>
      {articles.length === 0 ? (
        <section className="empty">
          <h2>This corner of the void is quiet.</h2>
          <p>No stories have been published in this language yet.</p>
          <Link href="/en">Read the English edition</Link>
        </section>
      ) : (
        <section aria-label="Published stories" className="story-grid">
          {articles.map((article, index) => (
            <article
              key={article.documentId}
              className={index === 0 ? 'story feature-story' : 'story'}
            >
              <Link
                className="story-image"
                href={articlePath(locale, article.documentId)}
                tabIndex={-1}
                aria-hidden="true"
              >
                {article.cover ? (
                  <Image
                    src={mediaUrl(article.cover.url)}
                    width={1600}
                    height={1000}
                    loading={index === 0 ? 'eager' : 'lazy'}
                    sizes="(max-width: 760px) 100vw, 65vw"
                    alt=""
                  />
                ) : (
                  <span className="image-placeholder" />
                )}
              </Link>
              <div className="story-copy">
                <div className="story-kicker">
                  <span>{article.category?.name ?? 'Void dispatch'}</span>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                </div>
                <h2>
                  <Link href={articlePath(locale, article.documentId)}>{article.title}</Link>
                </h2>
                <p>{article.summary}</p>
                <div className="story-meta">
                  <span>{article.credits[0]?.name ?? 'The editorial void'}</span>
                  <span>{article.readingMinutes ?? 5} min read</span>
                </div>
                <Link className="read-link" href={articlePath(locale, article.documentId)}>
                  Read the story <span aria-hidden="true">↗</span>
                </Link>
              </div>
            </article>
          ))}
        </section>
      )}
      <FeaturePlayground locale={locale} />
      <aside className="closing-note">
        <span>Officially unqualified</span>
        <p>
          We came.
          <br />
          We yoinked.
        </p>
        <span>Your lawn. Our emotional support system.</span>
      </aside>
    </main>
  );
}
