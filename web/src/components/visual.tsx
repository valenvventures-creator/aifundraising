import React from 'react';

/** Circular progress ring with the percentage in the middle. */
export function ProgressRing({ value, size = 88, stroke = 9, label, tone = 'gold', dark = false }: { value: number; size?: number; stroke?: number; label?: React.ReactNode; tone?: 'gold' | 'brand' | 'good'; dark?: boolean }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const id = React.useId().replace(/:/g, '');
  const stops = tone === 'gold' ? ['#f6d77a', '#d4a10c'] : tone === 'good' ? ['#6ee7b7', '#059669'] : ['#a5b4fc', '#4f46e5'];
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${pct}% complete`}>
      <svg width={size} height={size} className="-rotate-90">
        <defs><linearGradient id={`g${id}`} x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor={stops[0]} /><stop offset="1" stopColor={stops[1]} /></linearGradient></defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className={dark ? 'stroke-white/10' : 'stroke-slate-100'} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round" stroke={`url(#g${id})`}
          strokeDasharray={c} strokeDashoffset={c - (c * pct) / 100} style={{ transition: 'stroke-dashoffset 1s cubic-bezier(.16,1,.3,1)' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className={`font-bold ${dark ? 'text-white' : 'text-slate-900'}`} style={{ fontSize: size * 0.24 }}>{pct}%</span>
        {label && <span className={`mt-1 text-[10px] uppercase tracking-wider ${dark ? 'text-white/60' : 'text-slate-400'}`}>{label}</span>}
      </div>
    </div>
  );
}
