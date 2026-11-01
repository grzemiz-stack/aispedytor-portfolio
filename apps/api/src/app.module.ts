import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './common/config/secrets';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { EncryptionModule } from './common/encryption/encryption.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CompaniesModule } from './companies/companies.module';
import { OffersModule } from './offers/offers.module';
import { VehiclesModule } from './vehicles/vehicles.module';
import { ContractorsModule } from './contractors/contractors.module';
import { DemandsModule } from './demands/demands.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AiEvaluationModule } from './ai-evaluation/ai-evaluation.module';
import { MatchingModule } from './matching/matching.module';
import { RiskAnalysisModule } from './risk-analysis/risk-analysis.module';
import { EmailAgentModule } from './email-agent/email-agent.module';
import { RoutePlannerModule } from './route-planner/route-planner.module';
import { TollsModule } from './tolls/tolls.module';
import { LtlMatchingModule } from './ltl-matching/ltl-matching.module';
import { NegotiationModule } from './negotiation/negotiation.module';
import { HealthModule } from './health/health.module';
import { CacheModule } from './common/cache/cache.module';
import { QueueModule } from './common/queue/queue.module';
import { OfferExpiryTask } from './common/tasks/offer-expiry.task';
import { DataRetentionTask } from './common/tasks/data-retention.task';
import { TransEuAuthModule } from './trans-eu-auth/trans-eu-auth.module';
import { ExchangePublisherModule } from './exchange-publisher/exchange-publisher.module';
import { FleetPlanningModule } from './fleet-planning/fleet-planning.module';
import { GeocodingModule } from './geocoding/geocoding.module';

@Module({
  imports: [
    // validateEnv: a missing or unsafe JWT_SECRET / ENCRYPTION_KEY stops the start.
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60000, limit: 100 }]),
    ScheduleModule.forRoot(),
    CacheModule,
    QueueModule,
    PrismaModule,
    EncryptionModule,
    AuthModule,
    UsersModule,
    CompaniesModule,
    OffersModule,
    VehiclesModule,
    ContractorsModule,
    DemandsModule,
    NotificationsModule,
    AnalyticsModule,
    AiEvaluationModule,
    MatchingModule,
    RiskAnalysisModule,
    EmailAgentModule,
    TollsModule,
    RoutePlannerModule,
    GeocodingModule,
    LtlMatchingModule,
    NegotiationModule,
    HealthModule,
    TransEuAuthModule,
    ExchangePublisherModule,
    FleetPlanningModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    OfferExpiryTask,
    DataRetentionTask,
  ],
})
export class AppModule {}
