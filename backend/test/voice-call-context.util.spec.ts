import {
  buildCallContextInstructions,
  extractCallContextDebugInfo,
  formatCustomerNameForGreeting,
  sanitizeCallContext,
} from '../src/modules/voice/voice-call-context.util';
import { buildExampleOpeningMessage } from '../src/modules/voice/voice-opening.util';
import {
  buildVoiceRuntimeInstructions,
  VOICE_LANGUAGE_MATCH_HARD_RULE,
} from '../src/modules/voice/voice-runtime-instructions.util';

describe('voice-call-context.util', () => {
  const sampleContext = {
    bookingNumber: 'BK1234',
    customerName: 'Rahul Sharma',
    customerNumber: '9876543210',
    driverName: 'Ramesh',
    driverMobileNumber: '9999999999',
    productType: 'cab',
    city: 'Delhi',
    zone: 'South Delhi',
    package: '4 hours 40 km',
    endTime: '2026-06-23T18:30:00+05:30',
    totalCharges: 2500,
    balanceAmount: 850,
    paymentMode: 'cash',
    runningKms: 52,
    overtimeMinutes: 20,
    overtimeCharges: 200,
  };

  it('sanitizes and trims call context fields', () => {
    const sanitized = sanitizeCallContext({
      bookingNumber: '  BK1234 ',
      customerName: 'Rahul Sharma',
      totalCharges: 2500,
      balanceAmount: -5,
      apiKey: 'secret',
    });

    expect(sanitized).toEqual({
      bookingNumber: 'BK1234',
      customerName: 'Rahul Sharma',
      totalCharges: 2500,
    });
  });

  it('builds structured call context instructions', () => {
    const instructions = buildCallContextInstructions(sampleContext);

    expect(instructions).toContain('Booking Number: BK1234');
    expect(instructions).toContain('Balance Amount: ₹850');
    expect(instructions).toContain('Do not invent missing values');
    expect(instructions).not.toContain('undefined');
  });

  it('extracts safe runtime debug info', () => {
    expect(extractCallContextDebugInfo(sampleContext)).toEqual({
      hasCallContext: true,
      callContextKeys: expect.arrayContaining(['bookingNumber', 'customerName']),
      bookingNumber: 'BK1234',
      customerName: 'Rahul Sharma',
    });
  });

  it('formats customer name for greeting', () => {
    expect(formatCustomerNameForGreeting('Rahul Sharma')).toBe('Rahul ji');
  });

  it('builds opening example with customer name and booking number only', () => {
    const opening = buildExampleOpeningMessage(
      {
        agentName: 'Aisha',
        companyName: 'TATD',
        callPurpose: 'regarding your booking',
        openingGreeting: 'Namaste',
      },
      {
        bookingNumber: 'BK1234',
        customerName: 'Rahul Sharma',
      },
    );

    expect(opening).toContain('Namaste Rahul ji');
    expect(opening).toContain('booking BK1234');
    expect(opening).not.toContain('₹');
    expect(opening).not.toContain('Ramesh');
  });

  it('injects call context after playbook in normal mode instructions', () => {
    const callContextInstructions = buildCallContextInstructions({
      balanceAmount: 850,
    });
    const instructions = buildVoiceRuntimeInstructions({
      baseInstructions: 'Base voice behavior.',
      activePlaybook: {
        id: 'p1',
        title: 'Playbook',
        version: 1,
        playbookText: 'Playbook body',
        agentInstructions: 'Agent instructions',
        commonObjectionsJson: null,
        objectionResponsesJson: null,
        winningPhrasesJson: null,
        badPhrasesJson: null,
        qualificationSignalsJson: null,
        followUpRulesJson: null,
        safetyRulesJson: null,
      },
      callContextInstructions,
    });

    expect(instructions.indexOf('Base voice behavior.')).toBeLessThan(
      instructions.indexOf(VOICE_LANGUAGE_MATCH_HARD_RULE),
    );
    expect(instructions.indexOf(VOICE_LANGUAGE_MATCH_HARD_RULE)).toBeLessThan(
      instructions.indexOf('Playbook body'),
    );
    expect(instructions.indexOf('Playbook body')).toBeLessThan(
      instructions.indexOf('Balance Amount: ₹850'),
    );
  });
});
