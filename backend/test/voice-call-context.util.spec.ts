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
    bookingNumber: 'OD482917',
    customerName: 'Rahul Sharma',
    customerNumber: '9876543210',
    driverName: 'Rajesh Kumar',
    driverMobileNumber: '9999999999',
    totalCharges: 450,
    balanceAmount: 150,
    paymentMode: 'UPI',
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

  it('builds structured call context instructions for driver service', () => {
    const instructions = buildCallContextInstructions(sampleContext);

    expect(instructions).toContain('Call-specific context (on-demand driver service):');
    expect(instructions).toContain('Booking Number: OD482917');
    expect(instructions).toContain('Balance Amount: ₹150');
    expect(instructions).toContain('Domain lock:');
    expect(instructions).toContain("This call is ONLY about TATD's on-demand driver service booking.");
    expect(instructions).toContain('How was your experience with the driver service?');
    expect(instructions).toContain('Do not invent missing values');
    expect(instructions).not.toContain('undefined');
    expect(instructions).not.toMatch(/how was your delivery/i);
    expect(instructions).not.toMatch(/how was your order/i);
    expect(instructions).not.toMatch(/- (Trip|Destination|Package|Itinerary|Vacation|Tour):/i);
  });

  it('extracts safe runtime debug info', () => {
    expect(extractCallContextDebugInfo(sampleContext)).toEqual({
      hasCallContext: true,
      callContextKeys: expect.arrayContaining(['bookingNumber', 'customerName']),
      bookingNumber: 'OD482917',
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
        callPurpose: 'for a quick follow-up',
        openingGreeting: 'Namaste',
      },
      {
        bookingNumber: 'OD482917',
        customerName: 'Rahul Sharma',
      },
    );

    expect(opening).toBe(
      'Namaste Rahul ji, this is Aisha calling from TATD regarding your booking OD482917. Is this a good time to speak?',
    );
    expect(opening).not.toContain('follow-up');
    expect(opening).not.toContain('₹');
    expect(opening).not.toContain('Ramesh');
  });

  it('injects call context after playbook in normal mode instructions', () => {
    const callContextInstructions = buildCallContextInstructions({
      balanceAmount: 150,
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
      instructions.indexOf('Balance Amount: ₹150'),
    );
    expect(instructions).toContain('on-demand driver service');
    expect(instructions).toContain('Domain lock:');
  });
});
