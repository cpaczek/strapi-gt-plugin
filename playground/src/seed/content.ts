export const locales = [
  { code: 'en', name: 'English (en)' },
  { code: 'fr', name: 'French (fr)' },
  { code: 'ar', name: 'Arabic (ar)' },
];
export const category = { name: 'Certified voidposting', slug: 'certified-voidposting' };
const slang = [
  {
    term: 'block yoink',
    meaning:
      'The sudden acquisition of a cube, followed by a complete refusal to explain yourself.',
  },
  {
    term: 'dirt custody',
    meaning:
      'A deeply serious dispute about which tall purple-eyed person is responsible for one block of soil.',
  },
  {
    term: 'blink-tax',
    meaning:
      'The small object you take to compensate yourself for the inconvenience of teleporting.',
  },
  {
    term: 'stare crime',
    meaning:
      'Eye contact. No further evidence is required. Sentencing is immediate and extremely loud.',
  },
  {
    term: 'grasscident',
    meaning: 'An accidental lawn removal. Can happen seven times in a row. Still an accident.',
  },
  {
    term: 'voidposting',
    meaning:
      'Sending an overwrought personal update into the darkness and hoping the darkness leaves a comment.',
  },
];
export const editorialFieldContext =
  'This is an unofficial Minecraft Enderman fan zine. Keep the invented phrases block yoink, dirt custody, blink-tax, stare crime, grasscident, and voidposting unchanged. Translate surrounding prose with dry humor, melodrama, and the voice of a very tall unreliable narrator. Enderman is the character name.';
const defaultFields = {
  markdown: '',
  body: [],
  seo: {
    title: 'The Ender Post',
    description: 'An unofficial fan zine for tall tales and petty theft.',
    social: {
      title: 'Fresh from the void',
      description: 'Please direct complaints to the nearest empty dimension.',
    },
  },
  credits: [
    { name: 'Norb, keeper of the block', role: 'Unreliable narrator' },
    { name: 'The editorial void', role: 'Fact-checking, allegedly' },
  ],
  sections: [],
  glossary: slang,
  editorialNote:
    'A note from the editorial void: block yoink, dirt custody and blink-tax are our house slang. They mean the same thing in every language. The dignity of our narrators may vary.',
  featured: false,
  readingMinutes: 7,
  budget: 1250.5,
  preciseDistance: 3.125,
  archivalNumber: '9007199254740993',
  observationDate: '2026-06-18',
  departureTime: '06:30:00.000',
  observedAt: '2026-06-18T06:30:00.000Z',
  edition: 'field-notes' as const,
  coordinates: { latitude: 48.64, longitude: -2.03 },
  contactEmail: 'editor@example.invalid',
};
export const articles = [
  {
    publish: true,
    fields: {
      ...defaultFields,
      title: 'The custody hearing of Dirt Block 47',
      slug: 'custody-hearing-dirt-block-47',
      summary:
        'I took one grass block outside a café. Now there are lawyers, a visitation schedule, and a chicken who keeps saying objection.',
      featured: true,
      markdown:
        '## Minutes from the emergency dirt custody hearing\n\n**Present:** Norb, one furious gardener, a chicken of uncertain legal standing.\n\n- The block is to remain with Norb until sunset.\n- Both parties must stop calling it their emotional support cube.\n- The variable `block_id_47` is not negotiable.\n\n> No stare crime will be permitted in this courtroom.\n\n[Read the imaginary court rules](https://example.invalid/void-court).\n',
      body: [
        {
          type: 'paragraph' as const,
          children: [
            {
              type: 'text' as const,
              text: 'For the record, I did not steal the block. I noticed it. Intensely. With my hands. There is a difference, and I had prepared a seventeen-page statement about it. Unfortunately, I teleported into the hearing room without the statement. I did bring the block.',
            },
          ],
        },
        {
          type: 'heading' as const,
          level: 2 as const,
          children: [{ type: 'text' as const, text: 'Exhibit A: a very good cube' }],
        },
        {
          type: 'paragraph' as const,
          children: [
            {
              type: 'text' as const,
              text: 'The gardener called this a block yoink. I called it an emergency relocation. The grass had been standing in the same place for years. Had anyone asked how it felt? No. Only I had the courage to act. Also, it looked nice beside my other block.',
            },
          ],
        },
        {
          type: 'paragraph' as const,
          children: [
            {
              type: 'text' as const,
              text: 'The judge asked me to state my name. I said Norb. The judge asked me to look at the court. ',
            },
            { type: 'text' as const, text: 'I advised the court against that.', bold: true },
            {
              type: 'text' as const,
              text: ' A chicken entered a procedural objection. Nobody knew who had invited the chicken, but it had a clipboard, so we continued.',
            },
          ],
        },
        {
          type: 'heading' as const,
          level: 2 as const,
          children: [{ type: 'text' as const, text: 'The terms of dirt custody' }],
        },
        {
          type: 'paragraph' as const,
          children: [
            {
              type: 'text' as const,
              text: 'We agreed on alternate weekends and every other thunderstorm. The gardener would handle watering. I would handle standing motionless in a doorway at three in the morning while holding the child. Sorry. The block. My counsel has asked me to stop calling it the child.',
            },
          ],
        },
        {
          type: 'list' as const,
          format: 'unordered' as const,
          children: [
            {
              type: 'list-item' as const,
              children: [{ type: 'text' as const, text: 'No teleporting during handovers' }],
            },
            {
              type: 'list-item' as const,
              children: [
                {
                  type: 'text' as const,
                  text: 'No collecting a replacement block from the courthouse lawn',
                },
              ],
            },
            {
              type: 'list-item' as const,
              children: [
                {
                  type: 'text' as const,
                  text: 'The chicken must disclose any conflict of interest',
                },
              ],
            },
          ],
        },
        {
          type: 'paragraph' as const,
          children: [
            {
              type: 'text' as const,
              text: 'As I left, I saw a lovely patch of gravel beside the steps. Reader, I am not proud of the next part. But I was under a lot of stress, and everyone deserves a little blink-tax.',
            },
          ],
        },
      ],
      sections: [
        {
          __component: 'editorial.pull-quote' as const,
          quote:
            'I have never stolen anything. I have simply changed where a thing lives, without consulting the thing-adjacent people.',
          attribution: 'Norb, under oath, unfortunately',
        },
        {
          __component: 'editorial.text-section' as const,
          heading: 'Correction, filed at 03:14',
          body: [
            {
              type: 'paragraph' as const,
              children: [
                {
                  type: 'text' as const,
                  text: 'An earlier version of this story described the chicken as impartial. The chicken owns three percent of the café. We regret the error, the hearing, and our entire legal department.',
                },
              ],
            },
          ],
        },
        {
          __component: 'editorial.gallery' as const,
          title: 'The block, before it hired representation',
          images: [],
        },
      ],
    },
  },
  {
    publish: true,
    fields: {
      ...defaultFields,
      title: 'An interview with a guy who has been holding sand for six years',
      slug: 'six-years-holding-sand',
      summary:
        'He says it is a temporary arrangement. We ask the difficult questions. He teleports away from all of them.',
      readingMinutes: 4,
      edition: 'interview' as const,
      body: [
        {
          type: 'paragraph' as const,
          children: [
            {
              type: 'text' as const,
              text: 'ENDER POST: Thank you for meeting us. May we ask about the sand?',
            },
          ],
        },
        {
          type: 'paragraph' as const,
          children: [
            {
              type: 'text' as const,
              text: 'VESK: You may ask. I reserve the right to stand behind you without warning.',
            },
          ],
        },
        {
          type: 'paragraph' as const,
          children: [{ type: 'text' as const, text: 'ENDER POST: Is the sand part of a project?' }],
        },
        {
          type: 'paragraph' as const,
          children: [
            {
              type: 'text' as const,
              text: 'VESK: Yes. The project is holding the sand. People insist on making this complicated. Six years ago I picked it up. Since then the plan has remained extremely consistent.',
            },
          ],
        },
        {
          type: 'heading' as const,
          level: 2 as const,
          children: [{ type: 'text' as const, text: 'A difficult subject: putting it down' }],
        },
        {
          type: 'paragraph' as const,
          children: [
            {
              type: 'text' as const,
              text: 'At this point, our interviewer suggested a shelf. Vesk stared at a distant mountain for eleven minutes, made a noise like a filing cabinet having a nightmare, and left. He returned carrying a different sand block. We have agreed not to discuss it.',
            },
          ],
        },
        {
          type: 'paragraph' as const,
          children: [
            {
              type: 'text' as const,
              text: 'The editorial verdict: this is either a moving meditation on commitment or a very slow grasscident. We cannot rule out both.',
            },
          ],
        },
      ],
    },
  },
  {
    publish: true,
    fields: {
      ...defaultFields,
      title: 'Missed connections: you looked at me; I took that personally',
      slug: 'missed-connections-stare-crime',
      summary:
        'You: carrying a torch. Me: three blocks tall, emotionally unavailable, suddenly sprinting. Was there a spark?',
      readingMinutes: 3,
      edition: 'essay' as const,
      body: [
        {
          type: 'paragraph' as const,
          children: [
            {
              type: 'text' as const,
              text: 'To the person outside the abandoned mineshaft: I think we had a moment. You looked directly into my eyes. I opened my mouth wider than any reasonable conversation required. These are the foundations of a meaningful connection.',
            },
          ],
        },
        {
          type: 'paragraph' as const,
          children: [
            {
              type: 'text' as const,
              text: 'I tried to express myself. You ran into a two-block-high doorway. This felt like a comment about my body. I respect boundaries, but I would appreciate it if your boundaries were taller.',
            },
          ],
        },
        {
          type: 'heading' as const,
          level: 2 as const,
          children: [{ type: 'text' as const, text: 'My love language is property relocation' }],
        },
        {
          type: 'paragraph' as const,
          children: [
            {
              type: 'text' as const,
              text: 'I left a gift outside your house. It used to be part of your house. Please accept it in the spirit in which it was removed. If you would like to meet again, stand perfectly still beside the lake. Actually, no lake. Why do I always forget the lake?',
            },
          ],
        },
        {
          type: 'paragraph' as const,
          children: [
            {
              type: 'text' as const,
              text: 'Signed, the tall one. Not that tall one. The other tall one. Holding dirt. No, the other other tall one holding dirt.',
            },
          ],
        },
      ],
    },
  },
  {
    publish: false,
    fields: {
      ...defaultFields,
      title: 'UNPUBLISHED: my extremely normal plan to steal the moon',
      slug: 'unpublished-steal-the-moon',
      summary:
        'An editorial draft. The moon has not been consulted, and this post must stay out of the public zine.',
      markdown: '',
      body: [],
      credits: [],
      sections: [],
      glossary: [],
      featured: false,
      readingMinutes: 3,
      budget: 0,
      preciseDistance: 0,
      coordinates: { latitude: 0, longitude: 0 },
    },
  },
];
