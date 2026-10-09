import { Injectable, Logger } from '@nestjs/common';
import { DEFAULT_JOB_RULES_SETTINGS, type JobRulesSettings, type JwtUser } from '@bitcrm/types';
import { JobRulesRepository } from './job-rules.repository';

/**
 * The account's job rules — Workiz's Account → Preferences switches that
 * change what happens to a job. Today one: "Update Job End Time" (a job
 * marked Done or Canceled ends at that moment), ON by default as on the
 * account the data came from; `DealsService.moveStatus` reads it.
 */
@Injectable()
export class JobRulesService {
  private readonly logger = new Logger(JobRulesService.name);

  constructor(private readonly repository: JobRulesRepository) {}

  /** The stored choices over the defaults; anything that is not a boolean reads as the default. */
  async get(): Promise<JobRulesSettings> {
    const stored = await this.repository.get();
    return {
      updateJobEndTimeOnClose:
        typeof stored?.updateJobEndTimeOnClose === 'boolean'
          ? stored.updateJobEndTimeOnClose
          : DEFAULT_JOB_RULES_SETTINGS.updateJobEndTimeOnClose,
    };
  }

  async update(dto: Partial<JobRulesSettings>, caller: JwtUser): Promise<JobRulesSettings> {
    const current = await this.get();
    const next: JobRulesSettings = {
      updateJobEndTimeOnClose: dto.updateJobEndTimeOnClose ?? current.updateJobEndTimeOnClose,
    };
    await this.repository.put(next);
    this.logger.log(`Job rules updated by ${caller.id}: updateJobEndTimeOnClose=${next.updateJobEndTimeOnClose}`);
    return next;
  }
}
