import { conditionFacts, type AutomationFacts } from '../../../../src/automations/engine/facts';

const facts: AutomationFacts = {
  deal: {
    id: 'd1',
    superStatus: 'submitted',
    subStatusId: 'sub-1',
    tagIds: ['tag-a'],
    sourceId: 'src-1',
    jobTypeId: 'jt-1',
    serviceAreaId: 'sa-1',
    assignedTechIds: ['t1'],
    assignedDispatcherId: 'u1',
    priority: 'high',
    paymentStatus: 'paid',
  },
  call: { callSid: 'CA1', direction: 'inbound', status: 'no-answer', agentId: 'u9' },
  message: { messageId: 'm1', channel: 'sms', partyKind: 'contact' },
};

describe('conditionFacts', () => {
  it('flattens every condition field the editor offers', () => {
    expect(conditionFacts('status', facts)).toEqual(['submitted']);
    expect(conditionFacts('subStatus', facts)).toEqual(['sub-1']);
    expect(conditionFacts('tag', facts)).toEqual(['tag-a']);
    expect(conditionFacts('source', facts)).toEqual(['src-1']);
    expect(conditionFacts('jobType', facts)).toEqual(['jt-1']);
    expect(conditionFacts('serviceArea', facts)).toEqual(['sa-1']);
    expect(conditionFacts('tech', facts)).toEqual(['t1']);
    expect(conditionFacts('hasTechs', facts)).toEqual(['t1']);
    expect(conditionFacts('dispatcher', facts)).toEqual(['u1']);
    expect(conditionFacts('priority', facts)).toEqual(['high']);
    expect(conditionFacts('paymentStatus', facts)).toEqual(['paid']);
    expect(conditionFacts('isLead', facts)).toEqual(['false']);
    expect(conditionFacts('callDirection', facts)).toEqual(['inbound']);
    expect(conditionFacts('callStatus', facts)).toEqual(['no-answer']);
    expect(conditionFacts('callAgent', facts)).toEqual(['u9']);
    expect(conditionFacts('messageChannel', facts)).toEqual(['sms']);
    expect(conditionFacts('messagePartyKind', facts)).toEqual(['contact']);
  });

  it('a voicemail answers `voicemail` rather than the provider status', () => {
    expect(conditionFacts('callStatus', { call: { callSid: 'CA2', status: 'completed', voicemail: true } })).toEqual([
      'voicemail',
    ]);
  });

  it('distinguishes "no value" from "not loaded"', () => {
    expect(conditionFacts('tag', { deal: { id: 'd2' } })).toEqual([]);
    expect(conditionFacts('tag', {})).toBeUndefined();
    expect(conditionFacts('status', { deal: { id: 'd2' } })).toBeUndefined();
  });
});
