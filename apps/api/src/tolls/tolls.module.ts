import { Global, Module } from '@nestjs/common';
import { TOLL_PROVIDER } from './toll-provider';

/**
 * The single place where the toll provider is chosen.
 *
 * Default: no provider (`null`) — the planner, LTL ranking and negotiation
 * show toll as missing (TOLL_PROVIDER_NOT_CONFIGURED) and mark costs as
 * incomplete. To plug one in, replace `useValue: null` with your
 * implementation, e.g. `useClass: MyTollProvider`, and run the contract tests
 * against it (see README, "Tolls — plugging in a provider").
 */
@Global()
@Module({
  providers: [{ provide: TOLL_PROVIDER, useValue: null }],
  exports: [TOLL_PROVIDER],
})
export class TollsModule {}
