'use client';
import { useState } from 'react';
import { formatEnderLedger, sampleExchange } from './formatting';

export const FeaturePlayground = ({ locale }: { locale: string }) => {
  const [input, setInput] = useState({
    locale,
    amount: 1234.5,
    currency: 'USD',
    blocks: 1,
    mood: 'calm',
    cutoff: 36,
    timeZone: 'UTC',
    numberStyle: 'decimal',
    numberingSystem: 'latn',
  });
  const [rate, setRate] = useState(0.92);
  const output = formatEnderLedger(input);
  return (
    <section className="feature-lab" id="gt-playground" aria-labelledby="lab-heading">
      <div className="lab-intro">
        <div>
          <span className="eyebrow">Please do not teleport the controls</span>
          <h2 id="lab-heading">
            The international
            <br />
            block market.
          </h2>
        </div>
        <p>
          A very serious test of General Translation's local formatting tools. Change the language,
          count, mood, or price. The dirt remains financially questionable.
        </p>
      </div>
      <div className="lab-controls">
        <label>
          Number style
          <select
            value={input.numberStyle}
            onChange={(event) => setInput({ ...input, numberStyle: event.target.value })}
          >
            <option value="decimal">Decimal</option>
            <option value="percent">Percent</option>
            <option value="unit">Distance in meters</option>
            <option value="compact">Compact</option>
          </select>
        </label>
        <label>
          Price and number digits
          <select
            value={input.numberingSystem}
            onChange={(event) => setInput({ ...input, numberingSystem: event.target.value })}
          >
            <option value="latn">Latin: 123</option>
            <option value="arab">Arabic: ١٢٣</option>
            <option value="deva">Devanagari: १२३</option>
          </select>
        </label>
        <label>
          Formatting language
          <select
            value={input.locale}
            onChange={(event) => setInput({ ...input, locale: event.target.value })}
          >
            <option value="en">English</option>
            <option value="fr">Français</option>
            <option value="ar">العربية</option>
            <option value="de">Deutsch</option>
            <option value="ja">日本語</option>
          </select>
        </label>
        <label>
          Alleged value
          <input
            type="number"
            min="0"
            max="1000000"
            step="0.5"
            value={input.amount}
            onChange={(event) =>
              setInput({
                ...input,
                amount: Math.max(0, Math.min(1000000, Number(event.target.value))),
              })
            }
          />
        </label>
        <label>
          Currency
          <select
            value={input.currency}
            onChange={(event) => setInput({ ...input, currency: event.target.value })}
          >
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="JPY">JPY</option>
            <option value="GBP">GBP</option>
          </select>
        </label>
        <label>
          Blocks in custody
          <input
            type="number"
            min="0"
            max="99"
            step="1"
            value={input.blocks}
            onChange={(event) =>
              setInput({
                ...input,
                blocks: Math.max(0, Math.min(99, Math.trunc(Number(event.target.value)))),
              })
            }
          />
        </label>
        <label>
          Witness mood
          <select
            value={input.mood}
            onChange={(event) => setInput({ ...input, mood: event.target.value })}
          >
            <option value="calm">Suspiciously calm</option>
            <option value="furious">Stare crime detected</option>
            <option value="mysterious">Declines to comment</option>
          </select>
        </label>
        <label>
          Hearing timezone
          <select
            value={input.timeZone}
            onChange={(event) => setInput({ ...input, timeZone: event.target.value })}
          >
            <option value="UTC">UTC</option>
            <option value="Europe/Paris">Paris</option>
            <option value="Asia/Tokyo">Tokyo</option>
          </select>
        </label>
      </div>
      <div className="lab-results" dir={output.direction} lang={input.locale} aria-live="polite">
        <div className="lab-result result-price">
          <span>Currency formatting</span>
          <output aria-label="Formatted currency">{output.currency}</output>
          <small>The same amount, dressed for the locale. No exchange-rate conversion.</small>
        </div>
        <div className="lab-result">
          <span>Number formatting</span>
          <output aria-label="Formatted number">{output.number}</output>
          <small>
            Decimal, compact, percent, or meters. A ratio of 0.5 is 50%. Units are formatted, not
            converted.
          </small>
        </div>
        <div className="lab-result result-message">
          <span>Plural + select messages</span>
          <output aria-label="Custody report">{output.message}</output>
          <small>
            English sample copy with locale-aware ICU selection. Formatting does not translate the
            sentence.
          </small>
        </div>
        <div className="lab-result">
          <span>Date + time</span>
          <output>{output.date}</output>
          <small>The hearing is fixed at October 10, 2026, 12:00 UTC.</small>
        </div>
        <div className="lab-result">
          <span>Relative time</span>
          <output>{output.relative}</output>
          <small>When Norb last claimed this was a temporary arrangement.</small>
        </div>
        <div className="lab-result">
          <span>Relative time from a date</span>
          <output>{output.relativeFromDate}</output>
          <small>Measured from the fixed hearing time, so the example stays repeatable.</small>
        </div>
        <div className="lab-result">
          <span>List formatting</span>
          <output>{output.list}</output>
          <small>A perfectly ordinary inventory.</small>
        </div>
        <div className="lab-result">
          <span>List parts</span>
          <output>
            {output.listParts.map((part, index) =>
              typeof part === 'string' ? (
                <span key={index}>{part}</span>
              ) : (
                <b key={part.id} className="inventory-tag">
                  {part.label}
                </b>
              )
            )}
          </output>
          <small>Each item keeps its own styling.</small>
        </div>
        <div className="lab-result result-cutoff">
          <span>Text cutoff</span>
          <output aria-label="Short statement">{output.cutoff || '(silence)'}</output>
          <label>
            Statement limit: {input.cutoff}
            <input
              aria-label="Statement character limit"
              type="range"
              min="0"
              max="75"
              value={input.cutoff}
              onChange={(event) => setInput({ ...input, cutoff: Number(event.target.value) })}
            />
          </label>
        </div>
        <div className="lab-result">
          <span>Locale + direction</span>
          <output>{output.localeName}</output>
          <small>
            {output.localeProperties.nativeName} / {output.localeProperties.scriptName} /{' '}
            {output.direction.toUpperCase()}
          </small>
        </div>
      </div>
      <div className="exchange-example">
        <div>
          <h3>The imaginary exchange desk</h3>
          <p>
            GT formats money; it does not fetch exchange rates or convert currencies. This separate
            calculator multiplies your amount as USD by the sample rate you enter, then asks GT to
            format the EUR result. No live rate, purchase, or payment.
          </p>
        </div>
        <label>
          Sample EUR per USD
          <input
            type="number"
            min="0"
            max="10"
            step="0.01"
            value={rate}
            onChange={(event) => setRate(Math.max(0, Math.min(10, Number(event.target.value))))}
          />
        </label>
        <output aria-label="Sample conversion">
          {sampleExchange(input.amount, rate, input.locale)}
        </output>
      </div>
      <p className="lab-footnote">
        Nine public GT formatters, plus locale helpers. Sample sentences, list items, and cutoff
        text stay in English. These controls need no API key. Published story translations and the
        slang glossary come from the Strapi workflow above.
      </p>
    </section>
  );
};
