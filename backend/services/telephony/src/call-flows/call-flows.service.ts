import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { tryNormalizePhone } from '@bitcrm/shared';
import {
  CALL_FLOW_LIMITS,
  type CallFlow,
  type CallFlowNode,
} from '@bitcrm/types';
import { CallFlowsRepository } from './call-flows.repository';
import { CallGroupsService } from '../call-groups/call-groups.service';
import {
  type CreateCallFlowDto,
  type SimpleCallFlowDto,
  type UpdateCallFlowDto,
} from './dto/call-flow.dto';

@Injectable()
export class CallFlowsService {
  private readonly logger = new Logger(CallFlowsService.name);

  constructor(
    private readonly repository: CallFlowsRepository,
    private readonly groups: CallGroupsService,
  ) {}

  /* ------------------------------------------------------------ reading */

  async list(): Promise<CallFlow[]> {
    const flows = await this.repository.listAll();
    return flows.sort((a, b) => a.name.localeCompare(b.name));
  }

  async findById(id: string): Promise<CallFlow> {
    const flow = await this.repository.get(id);
    if (!flow) throw new NotFoundException(`Call flow ${id} not found`);
    return flow;
  }

  /**
   * The flow that answers this number, or null to fall back to today's
   * behaviour. Matched on the normalized form so a number stored one way and
   * reported another by Twilio still finds its flow.
   */
  async findByNumber(rawNumber: string): Promise<CallFlow | null> {
    const wanted = tryNormalizePhone(rawNumber) ?? rawNumber;
    const flows = await this.repository.listAll();
    return (
      flows.find(
        (flow) =>
          flow.active &&
          flow.numbers.some((n) => (tryNormalizePhone(n) ?? n) === wanted),
      ) ?? null
    );
  }

  /* ------------------------------------------------------------ writing */

  async create(dto: CreateCallFlowDto, caller: { id: string }): Promise<CallFlow> {
    const name = dto.name.trim();
    await this.assertNameAvailable(name);
    const numbers = await this.normalizeNumbers(dto.numbers ?? []);

    const nodes = dto.nodes ?? {};
    const entryNodeId = dto.entryNodeId ?? Object.keys(nodes)[0] ?? '';
    const active = dto.active ?? true;
    await this.validateGraph(nodes, entryNodeId, active);

    const now = new Date().toISOString();
    const flow: CallFlow = {
      id: randomUUID(),
      name,
      description: dto.description?.trim() || undefined,
      numbers,
      entryNodeId,
      nodes,
      active,
      version: 1,
      createdBy: caller.id,
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.create(flow);
    return flow;
  }

  /**
   * Build a flow from the three questions that cover almost every line:
   * what the caller hears, who rings, and what happens when nobody answers.
   */
  async createSimple(
    dto: SimpleCallFlowDto,
    caller: { id: string },
  ): Promise<CallFlow> {
    return this.create(
      { ...this.simpleGraph(dto), name: dto.name, numbers: dto.numbers, active: dto.active },
      caller,
    );
  }

  async updateSimple(
    id: string,
    dto: SimpleCallFlowDto,
    caller: { id: string },
  ): Promise<CallFlow> {
    return this.update(
      id,
      { ...this.simpleGraph(dto), name: dto.name, numbers: dto.numbers, active: dto.active },
      caller,
    );
  }

  private simpleGraph(dto: SimpleCallFlowDto): {
    entryNodeId: string;
    nodes: Record<string, CallFlowNode>;
  } {
    const nodes: Record<string, CallFlowNode> = {};
    const greeting = dto.greeting?.trim();
    const endsWith = dto.noAnswer ?? 'voicemail';

    if (endsWith === 'voicemail') {
      nodes.end = {
        id: 'end',
        type: 'voicemail',
        prompt:
          dto.voicemailPrompt?.trim() ||
          'Please leave a message after the tone and we will call you back.',
        maxSeconds: dto.voicemailSeconds ?? CALL_FLOW_LIMITS.defaultVoicemailSeconds,
      };
    } else {
      nodes.end = {
        id: 'end',
        type: 'hangup',
        text: 'Sorry we missed you. Please try again later.',
      };
    }

    nodes.ring = { id: 'ring', type: 'ring', groupId: dto.groupId, next: 'end' };
    if (greeting) {
      nodes.greeting = { id: 'greeting', type: 'say', text: greeting, next: 'ring' };
    }
    return { entryNodeId: greeting ? 'greeting' : 'ring', nodes };
  }

  async update(
    id: string,
    dto: UpdateCallFlowDto,
    caller: { id: string },
  ): Promise<CallFlow> {
    const existing = await this.findById(id);
    const name = dto.name?.trim() ?? existing.name;
    if (dto.name !== undefined) await this.assertNameAvailable(name, id);

    const numbers =
      dto.numbers === undefined
        ? existing.numbers
        : await this.normalizeNumbers(dto.numbers, id);
    const nodes = dto.nodes ?? existing.nodes;
    const entryNodeId = dto.entryNodeId ?? existing.entryNodeId;
    const active = dto.active ?? existing.active;
    await this.validateGraph(nodes, entryNodeId, active);

    const updated: CallFlow = {
      ...existing,
      name,
      description:
        dto.description === undefined
          ? existing.description
          : dto.description.trim() || undefined,
      numbers,
      entryNodeId,
      nodes,
      active,
      // A call already running holds the version it started on, so this bump
      // never moves a live caller onto a node that has just changed.
      version: existing.version + 1,
      updatedBy: caller.id,
      updatedAt: new Date().toISOString(),
    };
    await this.repository.put(updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.findById(id);
    await this.repository.delete(id);
  }

  /* --------------------------------------------------------- validation */

  private async assertNameAvailable(name: string, excludeId?: string): Promise<void> {
    const clash = (await this.repository.listAll()).find(
      (f) => f.id !== excludeId && f.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (clash) {
      throw new ConflictException(`A call flow named "${clash.name}" already exists`);
    }
  }

  /**
   * A number can only be answered by one flow — two would be a coin toss over
   * what a caller hears.
   */
  private async normalizeNumbers(raw: string[], excludeId?: string): Promise<string[]> {
    const numbers: string[] = [];
    for (const value of raw) {
      const normalized = tryNormalizePhone(value);
      if (!normalized) {
        throw new BadRequestException(`${value} is not a valid phone number`);
      }
      if (!numbers.includes(normalized)) numbers.push(normalized);
    }

    const others = (await this.repository.listAll()).filter((f) => f.id !== excludeId);
    for (const number of numbers) {
      const clash = others.find((f) =>
        f.numbers.some((n) => (tryNormalizePhone(n) ?? n) === number),
      );
      if (clash) {
        throw new ConflictException(
          `${number} is already answered by "${clash.name}"`,
        );
      }
    }
    return numbers;
  }

  /**
   * Everything that would only surface as a caller hearing silence: a missing
   * entry node, a `next` pointing nowhere, a group that has been deleted, or a
   * cycle that would loop somebody forever.
   */
  private async validateGraph(
    nodes: Record<string, CallFlowNode>,
    entryNodeId: string,
    active: boolean,
  ): Promise<void> {
    const ids = Object.keys(nodes);
    if (ids.length > CALL_FLOW_LIMITS.maxNodes) {
      throw new BadRequestException(
        `A flow can hold at most ${CALL_FLOW_LIMITS.maxNodes} steps`,
      );
    }
    if (ids.length === 0) {
      if (active) {
        throw new BadRequestException(
          'A flow with no steps cannot be active — it would answer with silence',
        );
      }
      return;
    }
    if (!entryNodeId || !nodes[entryNodeId]) {
      throw new BadRequestException('The flow has no valid first step');
    }

    for (const [id, node] of Object.entries(nodes)) {
      if (node.id !== id) {
        throw new BadRequestException(`Step ${id} disagrees with its own id`);
      }
      if (node.next && !nodes[node.next]) {
        throw new BadRequestException(`Step ${id} points at a step that does not exist`);
      }
      if (node.type === 'ring') {
        // Throws NotFound if the group is gone — better here than mid-call.
        await this.groups.findById(node.groupId);
      }
    }

    // Cycles: walk from the entry and refuse to revisit.
    const seen = new Set<string>();
    let cursor: string | undefined = entryNodeId;
    while (cursor) {
      if (seen.has(cursor)) {
        throw new BadRequestException('The flow loops back on itself');
      }
      seen.add(cursor);
      cursor = nodes[cursor]?.next;
    }
  }
}
