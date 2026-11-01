/**
 * The test fake passes the TollProvider contract — the contract itself is
 * exercised on every run, so it cannot rot unnoticed.
 */
import { runTollProviderContract } from './toll-provider.contract';
import { FixedRateTollProvider } from '../fakes/fixed-rate-toll-provider';

runTollProviderContract('FixedRateTollProvider (test fake)', {
  make: () => new FixedRateTollProvider(),
  failing: () => new FixedRateTollProvider({ failWith: 'unauthorized' }),
});
