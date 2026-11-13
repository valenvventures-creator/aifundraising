/**
 * The A.I. Fundraising logo: the lions-and-gate emblem and the wordmark set as one lockup.
 * The wordmark is set in Libre Baskerville Bold capitals, matching the bracketed serif "T" inside the gate, in the same gold as the emblem.
 */
import React from 'react';

type Size = 'xs' | 'sm' | 'md' | 'lg';
const SIZES: Record<Size, { emblem: number; word: number; sub: number; gap: number }> = {
  xs: { emblem: 26, word: 12.5, sub: 7, gap: 8 },
  sm: { emblem: 30, word: 15.5, sub: 7.5, gap: 10 },
  md: { emblem: 42, word: 21, sub: 8.5, gap: 13 },
  lg: { emblem: 72, word: 31, sub: 11, gap: 16 },
};

/** Gold that reads well on white (deeper) or on dark backgrounds (brighter). */
const goldText = (onDark: boolean): React.CSSProperties => ({
  backgroundImage: onDark ? 'linear-gradient(180deg, #f6d66e 0%, #e8b21e 55%, #c9940f 100%)' : 'linear-gradient(180deg, #e8b21e 0%, #c9940f 55%, #9a7209 100%)',
  WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
});

export function BrandLockup({ size = 'md', onDark = false, stacked = false, showSub = false, className = '' }: { size?: Size; onDark?: boolean; stacked?: boolean; showSub?: boolean; className?: string }) {
  const s = SIZES[size];
  const words = (
    <span className="flex flex-col leading-none" style={{ alignItems: stacked ? 'center' : 'flex-start' }}>
      <span style={{ fontFamily: '"Libre Baskerville", "Baskerville", "Times New Roman", Georgia, serif', fontWeight: 700, fontSize: s.word, letterSpacing: '0.035em', whiteSpace: 'nowrap', ...goldText(onDark) }}>A.I. FUNDRAISING</span>
      {showSub && <span style={{ fontFamily: '"Libre Baskerville", Georgia, serif', fontWeight: 700, fontSize: s.sub, letterSpacing: '0.34em', marginTop: Math.round(s.word * 0.32), whiteSpace: 'nowrap', color: onDark ? 'rgba(246,214,110,.75)' : '#9a7209' }}>THOUGHT AUTHORITIES</span>}
    </span>
  );
  const emblem = <img src="/logo-emblem.webp" alt="" style={{ height: stacked ? s.emblem * 1.6 : s.emblem, width: 'auto' }} className="shrink-0 select-none" draggable={false} />;
  if (stacked) return <span className={`inline-flex flex-col items-center ${className}`} style={{ gap: s.gap }} role="img" aria-label="A.I. Fundraising">{emblem}{words}</span>;
  return (
    <span className={`inline-flex items-center ${className}`} style={{ gap: s.gap }} role="img" aria-label="A.I. Fundraising">
      {emblem}
      <span aria-hidden className="self-stretch" style={{ width: 1, margin: `${Math.round(s.emblem * 0.12)}px 0`, background: onDark ? 'linear-gradient(180deg, transparent, rgba(232,178,30,.7), transparent)' : 'linear-gradient(180deg, transparent, #d4a10c, transparent)' }} />
      {words}
    </span>
  );
}
