import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { tryNormalizePhone } from '@bitcrm/shared';
import {
  CALL_FLOW_LIMITS,
  ringTargetOf,
  type CallFlow,
  type CallFlowNode,
  type RingNode,
} from '@bitcrm/types';
import { UserDirectoryService } from '../common/user-directory.service';
import { CallDevicesService } from '../call-devices/call-devices.service';

/**
 * Telephony runs without a global ValidationPipe, so the body is raw JSON:
 * anything but a non-blank string means "no company".
 */
function normalizeCompanyId(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

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
    // Optional so the older specs construct the service with the repository
    // and the groups alone; without them a user or device target is taken on
    // trust (it is still checked at ring time, where a gone one falls back).
    @Optional() private readonly directory?: UserDirectoryService,
    @Optional() private readonly devices?: CallDevicesService,
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

    const nodes = this.normalizeNodes(dto.nodes ?? {});
    const entryNodeId = dto.entryNodeId ?? Object.keys(nodes)[0] ?? '';
    const active = dto.active ?? true;
    await this.validateGraph(nodes, entryNodeId, active, numbers);

    const now = new Date().toISOString();
    const businessProfileId = normalizeCompanyId(dto.businessProfileId);
    const flow: CallFlow = {
      id: randomUUID(),
      name,
      description: dto.description?.trim() || undefined,
      numbers,
      entryNodeId,
      nodes,
      active,
      ...(businessProfileId && { businessProfileId }),
      // Only an explicit switch is stored: absent means recorded, which is
      // what every flow did before the switch — old and new alike.
      ...(typeof dto.record === 'boolean' && { record: dto.record }),
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
      {
        ...this.simpleGraph(dto),
        name: dto.name,
        numbers: dto.numbers,
        active: dto.active,
        businessProfileId: dto.businessProfileId,
      },
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
      {
        ...this.simpleGraph(dto),
        name: dto.name,
        numbers: dto.numbers,
        active: dto.active,
        businessProfileId: dto.businessProfileId,
      },
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

    nodes.ring = {
      id: 'ring',
      type: 'ring',
      target: { kind: 'group', id: dto.groupId },
      next: 'end',
    };
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
    // Stored nodes are kept exactly as they are — a flow saved before targets
    // existed keeps its `groupId` ring through every unrelated edit.
    const nodes = dto.nodes ? this.normalizeNodes(dto.nodes) : existing.nodes;
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
      ...(typeof dto.record === 'boolean' && { record: dto.record }),
      // A call already running holds the version it started on, so this bump
      // never moves a live caller onto a node that has just changed.
      version: existing.version + 1,
      updatedBy: caller.id,
      updatedAt: new Date().toISOString(),
    };
    // undefined keeps the company; null / blank clears it.
    if (dto.businessProfileId !== undefined) {
      const businessProfileId = normalizeCompanyId(dto.businessProfileId);
      if (businessProfileId) updated.businessProfileId = businessProfileId;
      else delete updated.businessProfileId;
    }
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

  /**
   * The one thing a node carries that has a canonical form: an external
   * number, stored as E.164 so the runner dials exactly what was validated.
   * Returns a fresh map — the caller's nodes are never written through.
   */
  private normalizeNodes(nodes: Record<string, CallFlowNode>): Record<string, CallFlowNode> {
    const out: Record<string, CallFlowNode> = {};
    for (const [id, node] of Object.entries(nodes)) {
      if (node.type === 'ring' && node.target?.kind === 'external') {
        const raw = node.target.number;
        const number = typeof raw === 'string' ? tryNormalizePhone(raw) : null;
        if (!number) {
          throw new BadRequestException(`${raw} is not a valid phone number to forward to`);
        }
        out[id] = { ...node, target: { kind: 'external', number } };
      } else {
        out[id] = node;
      }
    }
    return out;
  }

  /**
   * A Forward step (Workiz's Group | User | External Number, plus our devices)
   * has to name something that can ring, and whatever it names has to exist
   * now — a gone group, user or device is far better refused here than met
   * mid-call. "Move to next step after N sec" stays inside what Twilio will
   * ring a leg for.
   */
  private async validateRingNode(node: RingNode): Promise<void> {
    const target = ringTargetOf(node);
    const named =
      target &&
      (target.kind === 'external' ? !!target.number : !!target.id);
    if (!target || !named) {
      throw new BadRequestException(
        'A Forward step needs somewhere to ring — a group, a user, a device or a number',
      );
    }
    switch (target.kind) {
      case 'group':
        // Throws NotFound if the group is gone — better here than mid-call.
        await this.groups.findById(target.id);
        break;
      case 'user':
        if (this.directory && !(await this.directory.find(target.id))) {
          throw new BadRequestException(
            `${target.id} is not an active user and cannot be forwarded to`,
          );
        }
        break;
      case 'device':
        if (this.devices && !(await this.devices.findRaw(target.id))) {
          throw new BadRequestException(
            `${target.id} is not a device in the catalog and cannot be forwarded to`,
          );
        }
        break;
      case 'external':
        if (!tryNormalizePhone(target.number)) {
          throw new BadRequestException(`${target.number} is not a valid phone number`);
        }
        break;
    }
    if (node.timeoutSec !== undefined) {
      const { minRingTimeoutSec: min, maxRingTimeoutSec: max } = CALL_FLOW_LIMITS;
      if (!Number.isInteger(node.timeoutSec) || node.timeoutSec < min || node.timeoutSec > max) {
        throw new BadRequestException(
          `"Move to next step after" must be between ${min} and ${max} seconds`,
        );
      }
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
        await this.validateRingNode(node);
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
