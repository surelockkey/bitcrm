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

/** Every step this one can lead to — `next` plus whatever branches it has. */
function exitsOf(node: CallFlowNode): string[] {
  const exits: (string | undefined)[] = [node.next];
  if (node.type === 'ring') exits.push(node.answeredNext);
  if (node.type === 'hours') exits.push(node.openNext);
  if (node.type === 'menu') exits.push(...node.options.map((o) => o.next));
  if (node.type === 'ext') exits.push(node.answeredNext);
  return exits.filter((id): id is string => !!id);
}
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
    await this.validateGraph(nodes, entryNodeId, active, numbers);

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
    // `numbers` and `id` matter here as much as on create: validateGraph runs
    // on EVERY update including an activate-only one, which is the moment a
    // paused technician line would otherwise become a second active one.
    await this.validateGraph(nodes, entryNodeId, active, numbers, id);

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
  /**
   * The technician dial-in has two rules the other node types do not need, and
   * both exist because the line has to be FINDABLE.
   *
   * A technician dials a number from memory or a saved contact. If no active
   * flow lists that number, `findByNumber` returns null and the caller drops
   * into "ring every online softphone" — or, with nobody online, gets hung up
   * on. And if two active flows both collect codes, which one answers is
   * whichever the catalog happens to return first.
   */
  private async validateExtNode(
    node: Extract<CallFlowNode, { type: 'ext' }>,
    active: boolean,
    numbers: string[],
    selfId?: string,
  ): Promise<void> {
    if (active && numbers.length === 0) {
      throw new BadRequestException(
        'A flow that collects a job code must answer at least one number — ' +
          'technicians dial it directly',
      );
    }
    if (node.repeats < 1 || node.repeats > CALL_FLOW_LIMITS.extMaxAttempts) {
      throw new BadRequestException(
        `Attempts must be between 1 and ${CALL_FLOW_LIMITS.extMaxAttempts}`,
      );
    }
    if (!active) return;

    const others = (await this.repository.listAll()).filter(
      (f) => f.id !== selfId && f.active,
    );
    const clash = others.find((f) =>
      Object.values(f.nodes ?? {}).some((n) => n.type === 'ext'),
    );
    if (clash) {
      throw new ConflictException(
        `"${clash.name}" is already the technician line — a workspace has one`,
      );
    }
  }

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
    /** The flow's own numbers — an ext flow must answer at least one. */
    numbers: string[] = [],
    /** The flow being saved, so it does not clash with itself. */
    selfId?: string,
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
      for (const exit of exitsOf(node)) {
        if (!nodes[exit]) {
          throw new BadRequestException(
            `Step ${id} points at a step that does not exist`,
          );
        }
      }
      if (node.type === 'ring') {
        // Throws NotFound if the group is gone — better here than mid-call.
        await this.groups.findById(node.groupId);
      }
      if (node.type === 'ext') {
        await this.validateExtNode(node, active, numbers, selfId);
      }
      if (node.type === 'menu') {
        if (node.options.length === 0) {
          throw new BadRequestException('A menu with no options traps the caller');
        }
        if (node.options.length > CALL_FLOW_LIMITS.maxMenuOptions) {
          throw new BadRequestException(
            `A menu can offer at most ${CALL_FLOW_LIMITS.maxMenuOptions} options`,
          );
        }
        const keys = new Set<string>();
        for (const option of node.options) {
          if (!/^[0-9*#]$/.test(option.key)) {
            throw new BadRequestException(`"${option.key}" is not a key a phone can send`);
          }
          if (keys.has(option.key)) {
            throw new BadRequestException(`Two menu options both use ${option.key}`);
          }
          keys.add(option.key);
        }
      }
      if (node.type === 'hours' && !node.windows?.length) {
        throw new BadRequestException(
          'Opening hours with no windows are closed forever — add one, or drop the step',
        );
      }
    }

    // Cycles, following every branch: a loop down the "closed" side is just as
    // trapping as one down the main line.
    const walk = (id: string, path: Set<string>): void => {
      if (path.has(id)) {
        throw new BadRequestException('The flow loops back on itself');
      }
      const node = nodes[id];
      if (!node) return;
      const nextPath = new Set(path).add(id);
      for (const exit of exitsOf(node)) walk(exit, nextPath);
    };
    walk(entryNodeId, new Set());
  }
}
