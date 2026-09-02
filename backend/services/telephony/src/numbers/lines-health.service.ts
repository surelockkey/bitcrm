import { Injectable } from '@nestjs/common';
import { NumbersService } from './numbers.service';
import { CallFlowsService } from '../call-flows/call-flows.service';
import { ServiceAreaNumbersService } from '../common/service-area-numbers.service';
import { TelephonySettingsService } from '../telephony/telephony-settings.service';

export interface LineHealth {
  number: string;
  /** What this number is FOR, in the operator's words. */
  role: string;
  /** Does the workspace still own it at Twilio? */
  owned: boolean;
  /** The active call flow that answers it, if any. */
  answeredBy?: string;
  problems: string[];
}

/**
 * Is every number this feature depends on still wired up?
 *
 * N market numbers is really N inbound configurations, and nothing keeps them
 * honest on its own: buying a number sets its voice URL, but binding it to a
 * market is a separate edit under a separate permission, and releasing it
 * touches neither. So a client can end up being called FROM a number that no
 * active flow answers — and six weeks later their callback is met with
 * "sorry, no agents are available" and a hang-up.
 *
 * This is the panel that catches that, rather than a technician mentioning it
 * in passing months later.
 */
@Injectable()
export class LinesHealthService {
  constructor(
    private readonly numbers: NumbersService,
    private readonly flows: CallFlowsService,
    private readonly areaNumbers: ServiceAreaNumbersService,
    private readonly settings: TelephonySettingsService,
  ) {}

  async check(): Promise<LineHealth[]> {
    const [owned, flows, areas] = await Promise.all([
      this.numbers.listOwned().catch(() => []),
      this.flows.list().catch(() => []),
      this.areaNumbers.listAll().catch(() => []),
    ]);

    const ownedSet = new Set(owned.map((n) => n.phoneNumber));
    const activeFlows = flows.filter((f) => f.active);
    const answeredBy = (number: string) =>
      activeFlows.find((f) => f.numbers?.includes(number));

    const rows: LineHealth[] = [];

    for (const area of areas) {
      if (!area.callerId) continue;
      const flow = answeredBy(area.callerId);
      const problems: string[] = [];
      if (!ownedSet.has(area.callerId)) {
        problems.push('the workspace no longer owns this number');
      }
      if (!flow) {
        // The expensive half of per-market numbers: outbound works fine, and
        // the callback is what breaks.
        problems.push('no active call flow answers it — callbacks will fail');
      } else if (
        Object.values(flow.nodes ?? {}).some((n) => n.type === 'ext')
      ) {
        problems.push(
          'answered by the technician line — a client calling back would be asked for a job code',
        );
      }
      rows.push({
        number: area.callerId,
        role: `${area.name} clients`,
        owned: ownedSet.has(area.callerId),
        answeredBy: flow?.name,
        problems,
      });
    }

    const configuredLine = await this.settings.technicianLine();
    if (configuredLine) {
      const line = configuredLine;
      const flow = answeredBy(line);
      const problems: string[] = [];
      if (!ownedSet.has(line)) {
        problems.push('the workspace no longer owns this number');
      }
      if (!flow) {
        problems.push('no active call flow answers it — technicians cannot dial in');
      } else if (
        !Object.values(flow.nodes ?? {}).some((n) => n.type === 'ext')
      ) {
        problems.push(
          `answered by "${flow.name}", which does not ask for a job code`,
        );
      }
      rows.push({
        number: line,
        role: 'Technician dial-in',
        owned: ownedSet.has(line),
        answeredBy: flow?.name,
        problems,
      });
    }

    return rows;
  }
}
