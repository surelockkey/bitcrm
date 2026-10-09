import { JobRulesService } from 'src/job-rules/job-rules.service';
import { type JwtUser } from '@bitcrm/types';

const caller: JwtUser = { id: 'admin-1', cognitoSub: 'sub', email: 'a@x.com', roleId: 'role-admin', department: 'HQ' };

/**
 * Account → Preferences in Workiz: "Update Job End Time" (ON on the account
 * the data came from). One config row; the deal service reads it when a job
 * closes, the settings page shows and flips it.
 */
describe('JobRulesService', () => {
  let repo: { get: jest.Mock; put: jest.Mock };
  let service: JobRulesService;

  beforeEach(() => {
    repo = { get: jest.fn().mockResolvedValue(null), put: jest.fn().mockResolvedValue(undefined) };
    service = new JobRulesService(repo as never);
  });

  it('updates the job end time on close by default, before anyone touched the page', async () => {
    expect(await service.get()).toEqual({ updateJobEndTimeOnClose: true });
  });

  it('reads a stored choice over the default', async () => {
    repo.get.mockResolvedValue({ updateJobEndTimeOnClose: false });
    expect(await service.get()).toEqual({ updateJobEndTimeOnClose: false });
  });

  it('ignores a stored value that is not a boolean', async () => {
    repo.get.mockResolvedValue({ updateJobEndTimeOnClose: 'no' });
    expect(await service.get()).toEqual({ updateJobEndTimeOnClose: true });
  });

  it('persists a change and answers with the whole settings', async () => {
    const next = await service.update({ updateJobEndTimeOnClose: false }, caller);

    expect(repo.put).toHaveBeenCalledWith({ updateJobEndTimeOnClose: false });
    expect(next).toEqual({ updateJobEndTimeOnClose: false });
  });

  it('an update that says nothing keeps what is there', async () => {
    repo.get.mockResolvedValue({ updateJobEndTimeOnClose: false });
    expect(await service.update({}, caller)).toEqual({ updateJobEndTimeOnClose: false });
    expect(repo.put).toHaveBeenCalledWith({ updateJobEndTimeOnClose: false });
  });
});
