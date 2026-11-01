import { dedupeMessages, msg, PLAN_MESSAGE_CODES } from './plan-messages';

describe('message codes', () => {
  it('are unique — two meanings behind one code is a silent mistake', () => {
    expect(new Set(PLAN_MESSAGE_CODES).size).toBe(PLAN_MESSAGE_CODES.length);
  });

  it('msg leaves out empty params so the JSON stays readable', () => {
    expect(msg('GVW_EXCEEDED')).toEqual({ code: 'GVW_EXCEEDED' });
    expect(msg('GVW_EXCEEDED', {})).toEqual({ code: 'GVW_EXCEEDED' });
  });

  it('msg carries params through untouched', () => {
    expect(msg('LOAD_PLAN_WEIGHT_EXCEEDED', { usedKg: 26000, maxKg: 24000 }))
      .toEqual({ code: 'LOAD_PLAN_WEIGHT_EXCEEDED', params: { usedKg: 26000, maxKg: 24000 } });
  });
});

describe('dedupeMessages', () => {
  it('compares by content, not by reference', () => {
    // Two separately created objects with the same content are one sentence
    // for the user — otherwise they would see it twice.
    const a = msg('LOAD_PLAN_LENGTH_EXCEEDED', { usedM: 14.2, maxM: 13.6 });
    const b = msg('LOAD_PLAN_LENGTH_EXCEEDED', { usedM: 14.2, maxM: 13.6 });

    expect(dedupeMessages([a, b])).toHaveLength(1);
  });

  it('keeps the same code when the numbers differ', () => {
    const a = msg('LOAD_PLAN_WEIGHT_EXCEEDED', { usedKg: 25000, maxKg: 24000 });
    const b = msg('LOAD_PLAN_WEIGHT_EXCEEDED', { usedKg: 26000, maxKg: 24000 });

    expect(dedupeMessages([a, b])).toHaveLength(2);
  });

  it('preserves the original order', () => {
    const first = msg('GVW_EXCEEDED', { grossKg: 41000 });
    const second = msg('LOAD_PLAN_LENGTH_EXCEEDED', { usedM: 14, maxM: 13.6 });

    expect(dedupeMessages([first, second, first]).map(m => m.code))
      .toEqual(['GVW_EXCEEDED', 'LOAD_PLAN_LENGTH_EXCEEDED']);
  });

  it('handles an empty list', () => {
    expect(dedupeMessages([])).toEqual([]);
  });
});
