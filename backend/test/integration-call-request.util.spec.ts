import { normalizeIntegrationCallRequest } from '../src/modules/integrations/integration-call-request.util';

describe('normalizeIntegrationCallRequest', () => {
  it('accepts standard camelCase payload', () => {
    expect(
      normalizeIntegrationCallRequest({
        externalRef: 'OD482917',
        customerNumber: '9876543210',
        callContext: {
          customerName: 'Rahul Sharma',
        },
      }),
    ).toEqual({
      externalRef: 'OD482917',
      customerNumber: '9876543210',
      callContext: {
        customerName: 'Rahul Sharma',
        customerNumber: '9876543210',
      },
    });
  });

  it('maps flat tatd-style snake_case fields', () => {
    expect(
      normalizeIntegrationCallRequest({
        booking_number: '100002',
        customer_mobile_number: '9876543210',
        customer_name: 'Rahul Sharma',
        driver_name: 'Rajesh Kumar',
        driver_mobile_number: '9999999999',
        total_charges: '450',
        balance_amount: '150',
        payment_mode: 'UPI',
        extra_partner_field: 'ignored',
      }),
    ).toEqual({
      externalRef: '100002',
      customerNumber: '9876543210',
      callContext: {
        bookingNumber: '100002',
        customerNumber: '9876543210',
        customerName: 'Rahul Sharma',
        driverName: 'Rajesh Kumar',
        driverMobileNumber: '9999999999',
        totalCharges: 450,
        balanceAmount: 150,
        paymentMode: 'UPI',
      },
    });
  });

  it('coerces numeric booking ids to strings', () => {
    expect(
      normalizeIntegrationCallRequest({
        booking_number: 100002,
        customer_mobile_number: 9876543210,
      }),
    ).toEqual({
      externalRef: '100002',
      customerNumber: '9876543210',
      callContext: {
        bookingNumber: '100002',
        customerNumber: '9876543210',
      },
    });
  });
});
