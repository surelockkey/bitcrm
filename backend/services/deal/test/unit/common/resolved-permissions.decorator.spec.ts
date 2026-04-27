import { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { ResolvedPerms } from 'src/common/decorators/resolved-permissions.decorator';

function getParamDecoratorFactory(decorator: Function) {
  class TestClass {
    public testMethod(@decorator() _value: any) {}
  }

  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, TestClass, 'testMethod');
  return args[Object.keys(args)[0]].factory;
}

describe('ResolvedPerms decorator', () => {
  const mockContext = (resolvedPermissions: any): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ resolvedPermissions }),
      }),
    }) as unknown as ExecutionContext;

  it('should return full resolvedPermissions when no data key', () => {
    const factory = getParamDecoratorFactory(ResolvedPerms);
    const perms = { permissions: {}, dataScope: {}, dealStageTransitions: ['*->*'] };
    const result = factory(undefined, mockContext(perms));
    expect(result).toEqual(perms);
  });

  it('should return specific key when data is provided', () => {
    // Test via direct function — the decorator extracts by data key
    class TestClass2 {
      public testMethod(@ResolvedPerms('dealStageTransitions') _value: any) {}
    }
    const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, TestClass2, 'testMethod');
    const factory = args[Object.keys(args)[0]].factory;

    const perms = { permissions: {}, dataScope: {}, dealStageTransitions: ['*->*'] };
    const result = factory('dealStageTransitions', mockContext(perms));
    expect(result).toEqual(['*->*']);
  });

  it('should return undefined when resolvedPermissions is not set', () => {
    const factory = getParamDecoratorFactory(ResolvedPerms);
    const result = factory(undefined, mockContext(undefined));
    expect(result).toBeUndefined();
  });
});
