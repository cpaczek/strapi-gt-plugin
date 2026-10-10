export const locales = [
  { code: 'en', name: 'English (en)' },
  { code: 'fr', name: 'French (fr)' },
  { code: 'ar', name: 'Arabic (ar)' },
];
export const category = { name: 'Coasts', slug: 'coasts' };
export const articles = [
  {
    publish: true,
    fields: {
      title: 'Where the tide leaves a story',
      slug: 'where-the-tide-leaves-a-story',
      summary:
        'A morning walk past the café and the harbor, with time to notice what the water leaves behind.',
      markdown:
        '## A slower route\n\nTake the **coastal path**, then turn at the [old harbor](https://example.invalid/harbor).\n\n- Bring a notebook\n- Keep `tide_time` unchanged\n\n> Stay until the light changes.\n',
      body: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'text',
              text: 'Before the first boats return, the shore belongs to the walkers. ',
            },
            { type: 'text', text: 'We took the long way home.', bold: true },
          ],
        },
        {
          type: 'heading',
          level: 2,
          children: [{ type: 'text', text: 'Small things worth keeping' }],
        },
        {
          type: 'paragraph',
          children: [
            { type: 'text', text: 'At the harbor wall, a handwritten notice reads ' },
            { type: 'text', text: 'bienvenue', italic: true },
            { type: 'text', text: '. The café opens when the bread arrives.' },
          ],
        },
        {
          type: 'list',
          format: 'unordered',
          children: [
            {
              type: 'list-item',
              children: [{ type: 'text', text: 'Watch the tide from the stone steps' }],
            },
            {
              type: 'list-item',
              children: [{ type: 'text', text: 'Leave the shells where they lie' }],
            },
          ],
        },
      ],
      seo: {
        title: 'A walk beside the changing tide',
        description: 'Field notes from a quiet stretch of coast.',
        social: { title: 'Notes from the shore', description: 'Light, salt, and a slow morning.' },
      },
      credits: [
        { name: 'Mara Bell', role: 'Words and field notes' },
        { name: 'Idris Noor', role: 'Illustration' },
      ],
      sections: [
        {
          __component: 'editorial.pull-quote',
          quote: 'A coastline is a place you can visit twice and never find unchanged.',
          attribution: 'Mara Bell',
        },
        {
          __component: 'editorial.text-section',
          heading: 'The walk back',
          body: [
            {
              type: 'paragraph',
              children: [
                {
                  type: 'text',
                  text: 'By noon, the footprints had gone. We left the notebook open on the kitchen table.',
                },
              ],
            },
          ],
        },
        { __component: 'editorial.gallery', title: 'Along the water', images: [] },
      ],
      featured: true,
      readingMinutes: 7,
      budget: 1250.5,
      preciseDistance: 3.125,
      observationDate: '2026-06-18',
      departureTime: '06:30:00.000',
      observedAt: '2026-06-18T06:30:00.000Z',
      edition: 'field-notes',
      coordinates: { latitude: 48.64, longitude: -2.03 },
      contactEmail: 'editor@example.invalid',
    },
  },
  {
    publish: false,
    fields: {
      title: 'The unpublished lighthouse notebook',
      slug: 'unpublished-lighthouse-notebook',
      summary: 'This draft is a visibility control. It must not appear in the reader.',
      markdown: '',
      body: [],
      seo: { title: 'Lighthouse draft', description: '', social: { title: '', description: '' } },
      credits: [],
      sections: [],
      featured: false,
      readingMinutes: 3,
      budget: 0,
      preciseDistance: 0,
      observationDate: '2026-06-19',
      departureTime: '07:00:00.000',
      observedAt: '2026-06-19T07:00:00.000Z',
      edition: 'field-notes',
      coordinates: { latitude: 0, longitude: 0 },
      contactEmail: 'editor@example.invalid',
    },
  },
];
