import { Module } from '@nestjs/common';
import { ContractorsService } from './contractors.service';
import { ContractorsController } from './contractors.controller';

@Module({ providers: [ContractorsService], controllers: [ContractorsController], exports: [ContractorsService] })
export class ContractorsModule {}
