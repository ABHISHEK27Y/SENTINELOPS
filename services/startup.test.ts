import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({
  startTelemetry: vi.fn(),
  stopTelemetry: vi.fn(),
  build: vi.fn(),
  context: { start: vi.fn(), stop: vi.fn(), log: { info: vi.fn() } },
}));
vi.mock('@sentinelops/service-kit/telemetry', () => ({
  startTelemetry: service.startTelemetry,
  stopTelemetry: service.stopTelemetry,
}));
vi.mock('./user-service/src/app.js', () => ({ buildUserService: service.build }));
vi.mock('./order-service/src/app.js', () => ({ buildOrderService: service.build }));
vi.mock('./payment-service/src/app.js', () => ({ buildPaymentService: service.build }));
vi.mock('./notification-service/src/app.js', () => ({ buildNotificationService: service.build }));
vi.mock('./api-gateway/src/app.js', () => ({ buildApiGateway: service.build }));

const signals = new Map<string, () => void>();
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  signals.clear();
  service.build.mockReturnValue(service.context);
  service.startTelemetry.mockResolvedValue(undefined);
  service.stopTelemetry.mockResolvedValue(undefined);
  service.context.start.mockResolvedValue(undefined);
  service.context.stop.mockResolvedValue(undefined);
  const originalOn = process.on.bind(process);
  vi.spyOn(process, 'on').mockImplementation(((event: string, listener: () => void) => {
    if (['SIGTERM', 'SIGINT'].includes(event)) {
      signals.set(event, listener);
      return process;
    }
    return originalOn(event, listener);
  }) as typeof process.on);
  vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('business service startup and shutdown', () => {
  it.each([
    ['user-service', 'USER_SERVICE_PORT', () => import('./user-service/src/index.js')],
    ['order-service', 'ORDER_SERVICE_PORT', () => import('./order-service/src/index.js')],
    ['payment-service', 'PAYMENT_SERVICE_PORT', () => import('./payment-service/src/index.js')],
    [
      'notification-service',
      'NOTIFICATION_SERVICE_PORT',
      () => import('./notification-service/src/index.js'),
    ],
    ['api-gateway', 'API_GATEWAY_PORT', () => import('./api-gateway/src/index.js')],
  ] as const)(
    'starts %s instrumentation first and drains before exiting',
    async (name, portKey, load) => {
      vi.stubEnv(portKey, '8123');
      await load();
      expect(service.startTelemetry).toHaveBeenCalledWith(name);
      expect(service.startTelemetry.mock.invocationCallOrder[0]).toBeLessThan(
        service.build.mock.invocationCallOrder[0]!
      );
      expect(service.context.start).toHaveBeenCalledWith(8123);
      signals.get('SIGTERM')?.();
      await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(0));
      expect(service.context.stop.mock.invocationCallOrder[0]).toBeLessThan(
        service.stopTelemetry.mock.invocationCallOrder[0]!
      );
      expect(service.stopTelemetry).toHaveBeenCalledOnce();
    }
  );
  it('does not register a false ready shutdown path after listener startup fails', async () => {
    service.context.start.mockRejectedValue(new Error('port occupied'));
    await expect(import('./payment-service/src/index.js')).rejects.toThrow('port occupied');
    expect(signals.size).toBe(0);
  });
});
