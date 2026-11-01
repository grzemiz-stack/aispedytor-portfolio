import { Module } from '@nestjs/common';
import { DemandsService } from './demands.service';
import { DemandsController } from './demands.controller';

@Module({ providers: [DemandsService], controllers: [DemandsController], exports: [DemandsService] })
export class DemandsModule {}
