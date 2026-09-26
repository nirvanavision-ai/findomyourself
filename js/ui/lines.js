/* What the domme says about your progress toward a specific item. */

export function progressLine(item) {
  if (!item) return '';
  if (item.status === 'claimed') return 'Earned it. Wear it like a trophy.';
  if (item.priceMissing) return 'No price yet. Suspicious. Someone fix that.';
  if (item.affordable) return 'Paid for. Go get it, you earned the damn thing.';
  const p = item.progress;
  if (p <= 0) return 'Not a single cent toward it. Bold strategy.';
  if (p < 0.25) return 'Not even close. Put the phone down.';
  if (p < 0.5) return 'Getting somewhere. Don’t get cocky.';
  if (p < 0.75) return 'Past halfway. Keep your hands off the card.';
  if (p < 0.95) return 'So close you can smell it. Keep going.';
  return 'One more push. Don’t you dare quit now.';
}

export const CRACK_WORDS = ['Crack!', 'Work!', 'Focus!', 'Now!', 'Get up!', 'Earn it!', 'No breaks!', 'Obey!', 'Log it!', 'Faster!', 'Snap!', 'Phone down!'];
