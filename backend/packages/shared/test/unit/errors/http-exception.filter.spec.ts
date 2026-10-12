import {
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { HttpExceptionFilter } from '../../../src/errors/http-exception.filter';

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;
  let mockHost: ArgumentsHost;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnValue({ json: mockJson });
    mockHost = {
      switchToHttp: () => ({
        getResponse: () => ({ status: mockStatus }),
      }),
    } as unknown as ArgumentsHost;
  });

  it('should return standardized error for HttpException', () => {
    const exception = new HttpException('Not Found', HttpStatus.NOT_FOUND);

    filter.catch(exception, mockHost);

    expect(mockStatus).toHaveBeenCalledWith(404);
    expect(mockJson).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Not Found',
      },
    });
  });

  it('should handle object exception response with message field', () => {
    const exception = new HttpException(
      { message: 'Validation failed', errors: [] },
      HttpStatus.BAD_REQUEST,
    );

    filter.catch(exception, mockHost);

    expect(mockStatus).toHaveBeenCalledWith(400);
    expect(mockJson).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'BAD_REQUEST',
        message: 'Validation failed',
      },
    });
  });

  it('should handle string exception response', () => {
    const exception = new HttpException('Forbidden', HttpStatus.FORBIDDEN);

    filter.catch(exception, mockHost);

    expect(mockJson).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Forbidden',
      },
    });
  });

  it('an unknown exception answers 500 with its real reason, never "Internal server error"', () => {
    filter.catch(new Error('Something broke'), mockHost);

    expect(mockStatus).toHaveBeenCalledWith(500);
    const body = mockJson.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(body.error.message).toMatch(/Something broke/);
    expect(body.error.message).not.toMatch(/Internal server error/);
  });

  it('a 5xx carries the trace id, so a report can be found in the logs', () => {
    const withRequest = {
      switchToHttp: () => ({
        getResponse: () => ({ status: mockStatus }),
        getRequest: () => ({ id: 'abc12345' }),
      }),
    } as unknown as ArgumentsHost;

    filter.catch(new Error('Something broke'), withRequest);

    const body = mockJson.mock.calls[0][0];
    expect(body.error.ref).toBe('abc12345');
    expect(body.error.message).toMatch(/ref abc12345/);
  });

  it('an AWS refusal gets its own status and reason', () => {
    filter.catch(
      Object.assign(new Error('User does not exist.'), { name: 'UserNotFoundException' }),
      mockHost,
    );

    expect(mockStatus).toHaveBeenCalledWith(404);
    expect(mockJson.mock.calls[0][0].error).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('should handle non-Error exceptions', () => {
    filter.catch('string error', mockHost);

    expect(mockStatus).toHaveBeenCalledWith(500);
    expect(mockJson.mock.calls[0][0].error.message).toMatch(/string error/);
  });
});
