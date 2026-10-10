'use client';
import { buildMessage } from '../../../packages/plugin/shared/messages';
const unavailable = buildMessage({
  code: 'reader-unavailable',
  happened: 'The journal could not load this story',
  why: 'The content server is unavailable',
  fix: 'Try again in a moment',
  fallback: 'Return to the journal later',
});
export default function ReaderError({ reset }: { reset: () => void }) {
  return (
    <main id="main" className="empty">
      <h1>The journal is resting.</h1>
      <p role="alert">{unavailable.text}</p>
      <button onClick={reset}>Try again</button>
    </main>
  );
}
