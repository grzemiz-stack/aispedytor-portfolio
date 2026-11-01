/**
 * Default registration: no toll provider.
 */
import 'reflect-metadata';
import { TollsModule } from '../../src/tolls/tolls.module';
import { TOLL_PROVIDER, TollProviderError } from '../../src/tolls/toll-provider';

it('registers TOLL_PROVIDER as null by default — nothing computes toll amounts', () => {
  const providers = Reflect.getMetadata('providers', TollsModule);
  expect(providers).toEqual([{ provide: TOLL_PROVIDER, useValue: null }]);
  expect(Reflect.getMetadata('exports', TollsModule)).toEqual([TOLL_PROVIDER]);
});

it('TollProviderError carries a machine-readable reason', () => {
  const e = new TollProviderError('timeout');
  expect(e).toBeInstanceOf(Error);
  expect([e.name, e.reason, e.message]).toEqual(['TollProviderError', 'timeout', 'Toll provider error: timeout']);
});
