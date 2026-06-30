import { TelephonyProviderConfigService } from '../src/modules/voice/telephony/telephony-provider.config';
import { TelephonyProvider } from '../src/modules/voice/telephony/telephony-provider.types';

describe('TelephonyProviderConfigService', () => {
  const buildService = (env: Record<string, string | undefined>) =>
    new TelephonyProviderConfigService({
      get: (key: string) => env[key],
    } as never);

  it('defaults to smartflo when TELEPHONY_PROVIDER is missing', () => {
    const service = buildService({});
    expect(service.getProvider()).toBe(TelephonyProvider.SMARTFLO);
    expect(service.isSmartflo()).toBe(true);
    expect(service.isExotel()).toBe(false);
  });

  it('selects exotel only when explicitly configured', () => {
    const service = buildService({ TELEPHONY_PROVIDER: 'exotel' });
    expect(service.getProvider()).toBe(TelephonyProvider.EXOTEL);
    expect(service.getOutboundMediaEncoding()).toBe('pcm16');
  });

  it('keeps smartflo outbound encoding as mulaw', () => {
    const service = buildService({ TELEPHONY_PROVIDER: 'smartflo' });
    expect(service.getProvider()).toBe(TelephonyProvider.SMARTFLO);
    expect(service.getOutboundMediaEncoding()).toBe('mulaw');
  });
});
