import { z } from 'zod';

export const readerLocales = ['en', 'fr', 'ar'] as const;
export type ReaderLocale = (typeof readerLocales)[number];
export const isReaderLocale = (value: string): value is ReaderLocale =>
  readerLocales.some((locale) => locale === value);
export const localeNames: Record<ReaderLocale, string> = {
  en: 'English',
  fr: 'Français',
  ar: 'العربية',
};
export const articlePath = (locale: ReaderLocale, documentId: string): string =>
  `/${locale}/articles/${encodeURIComponent(documentId)}`;
const mediaSchema = z.object({
  url: z.string(),
  alternativeText: z.string().nullable().optional(),
  caption: z.string().nullable().optional(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
});
export interface BlockNode {
  type: string;
  text?: string;
  level?: number;
  format?: string;
  url?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  code?: boolean;
  children?: BlockNode[];
  image?: { url: string; alternativeText?: string | null };
}
const blockSchema: z.ZodType<BlockNode> = z.lazy(() =>
  z.object({
    type: z.string(),
    text: z.string().optional(),
    level: z.number().optional(),
    format: z.string().optional(),
    url: z.string().optional(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    strikethrough: z.boolean().optional(),
    code: z.boolean().optional(),
    children: z.array(blockSchema).optional(),
    image: z
      .object({ url: z.string(), alternativeText: z.string().nullable().optional() })
      .optional(),
  })
);
const sectionSchema = z.discriminatedUnion('__component', [
  z.object({
    __component: z.literal('editorial.pull-quote'),
    quote: z.string(),
    attribution: z.string().nullable().optional(),
  }),
  z.object({
    __component: z.literal('editorial.text-section'),
    heading: z.string(),
    body: z.array(blockSchema),
  }),
  z.object({
    __component: z.literal('editorial.gallery'),
    title: z.string().nullable().optional(),
    images: z.array(mediaSchema).default([]),
  }),
]);
const articleSchema = z.object({
  documentId: z.string().min(1),
  locale: z.string(),
  title: z.string(),
  slug: z.string(),
  summary: z.string(),
  publishedAt: z.string().nullable(),
  body: z.array(blockSchema).default([]),
  markdown: z.string().nullable().optional(),
  glossary: z.array(z.object({ term: z.string(), meaning: z.string() })).default([]),
  editorialNote: z.string().nullable().optional(),
  readingMinutes: z.number().nullable().optional(),
  observationDate: z.string().nullable().optional(),
  cover: mediaSchema.nullable().optional(),
  sections: z.array(sectionSchema).default([]),
  category: z.object({ name: z.string() }).nullable().optional(),
  credits: z.array(z.object({ name: z.string(), role: z.string() })).default([]),
});
export type Article = z.infer<typeof articleSchema>;
interface ReaderOptions {
  origin: string;
  token?: string;
  fetch?: typeof fetch;
}

export const createContentReader = (options: ReaderOptions) => {
  const origin = new URL(options.origin);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password)
    throw new TypeError('Use an HTTP origin without credentials');
  const request = async (path: string, locale: ReaderLocale): Promise<unknown> => {
    const url = new URL(path, origin);
    url.searchParams.set('locale', locale);
    url.searchParams.set('status', 'published');
    url.searchParams.set('populate[cover]', 'true');
    url.searchParams.set('populate[category]', 'true');
    url.searchParams.set('populate[credits]', 'true');
    url.searchParams.set('populate[glossary]', 'true');
    url.searchParams.set('populate[sections][on][editorial.pull-quote][populate]', '*');
    url.searchParams.set('populate[sections][on][editorial.text-section][populate]', '*');
    url.searchParams.set('populate[sections][on][editorial.gallery][populate]', '*');
    const response = await (options.fetch ?? fetch)(url, {
      cache: 'no-store',
      headers: options.token ? { Authorization: `Bearer ${options.token}` } : {},
    });
    if (response.status === 404) return { data: null };
    if (!response.ok) throw new Error(`Content request failed with status ${response.status}`);
    const result: unknown = await response.json();
    return result;
  };
  return {
    list: async (locale: ReaderLocale): Promise<Article[]> => {
      const response = z
        .object({ data: z.array(articleSchema).nullable() })
        .parse(await request('/api/articles', locale));
      return (response.data ?? []).filter(
        (article) => article.publishedAt !== null && article.locale === locale
      );
    },
    get: async (documentId: string, locale: ReaderLocale): Promise<Article | null> => {
      const response = z
        .object({ data: articleSchema.nullable() })
        .parse(await request(`/api/articles/${encodeURIComponent(documentId)}`, locale));
      return response.data?.publishedAt &&
        response.data.locale === locale &&
        response.data.documentId === documentId
        ? response.data
        : null;
    },
  };
};
