import { isUpperBound, marginText, UPPER_BOUND_HINT, type MarginFields } from '@/lib/margin';

/** The offer margin: colour from the value, "≤" and a hint when it is an upper bound. */
export default function MarginBadge({ offer, size = 'xs' }: { offer: MarginFields; size?: 'xs' | 'sm' }) {
  if (offer.profitMarginPercent == null) return <span className={`text-gray-400 text-${size}`}>—</span>;
  const pct = Number(offer.profitMarginPercent);
  const bound = isUpperBound(offer);
  const color = bound
    ? 'bg-gray-100 text-gray-700'
    : pct >= 15 ? 'bg-green-100 text-green-700' : pct >= 5 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-${size} font-semibold ${color}`} title={bound ? UPPER_BOUND_HINT : undefined}>
      {marginText(offer)}
    </span>
  );
}
