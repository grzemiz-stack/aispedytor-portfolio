import { runDriverActivityProviderContract } from './driver-activity-provider.contract';
import { FakeDriverActivityProvider } from '../fakes/fake-driver-activity-provider';
import { d, status } from '../fixtures/driver-status';
import { HISTORY_AS_OF, syntheticHistory } from '../fixtures/driver-history';

runDriverActivityProviderContract('FakeDriverActivityProvider', {
  make: async () => ({
    provider: new FakeDriverActivityProvider(
      { 'driver-1': status() },
      {
        'driver-1': [
          // Deliberately out of order, and the first one starts before the coverage.
          { type: 'DRIVE', start: d('2026-10-05T06:00:00Z'), end: d('2026-10-05T10:30:00Z') },
          { type: 'REST', start: d('2026-09-26T00:00:00Z'), end: d('2026-10-05T06:00:00Z') },
          { type: 'REST', start: d('2026-10-05T10:30:00Z'), end: d('2026-10-05T11:15:00Z') },
          { type: 'WORK', start: d('2026-10-05T11:15:00Z'), end: d('2026-10-05T12:00:00Z') },
          { type: 'DRIVE', start: d('2026-10-11T22:00:00Z'), end: d('2026-10-12T02:00:00Z') },
        ],
      },
      { coveredFrom: d('2026-10-01T00:00:00Z') },
    ),
    knownDriverId: 'driver-1',
  }),
  failing: () => new FakeDriverActivityProvider({}, {}, { failing: true }),
});

// An adapter with only activities (a card file, telematics): the status is computed from 28 days of history.
runDriverActivityProviderContract('FakeDriverActivityProvider, status from history', {
  make: async () => ({
    provider: new FakeDriverActivityProvider({}, { 'driver-1': syntheticHistory() }, { statusFromHistory: { establishmentCountry: 'PL', asOf: HISTORY_AS_OF } }),
    knownDriverId: 'driver-1',
  }),
});
