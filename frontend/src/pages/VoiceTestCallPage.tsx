import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Modal';
import { ErrorState } from '../components/ui/Table';
import { voiceApi } from '../lib/voiceApi';
import { VoiceTestCallResponse } from '../types/voice';

function extractErrorMessage(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof (error as { response?: { data?: { message?: unknown } } }).response
      ?.data?.message !== 'undefined'
  ) {
    const message = (error as { response: { data: { message: unknown } } })
      .response.data.message;
    if (Array.isArray(message)) {
      return message.join(', ');
    }
    if (typeof message === 'string') {
      return message;
    }
  }

  return 'Unable to initiate test call. Please try again.';
}

export function VoiceTestCallPage() {
  const [customerNumber, setCustomerNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<VoiceTestCallResponse | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const response = await voiceApi.initiateTestCall({
        customerNumber: customerNumber.trim(),
      });
      setResult(response);

      if (!response.success) {
        setError(response.message);
      }
    } catch (requestError) {
      setError(extractErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">AI Voice Test Call</h1>
          <p className="mt-1 text-sm text-slate-400">
            Internal Smartflo click-to-call trigger for live voice streaming tests.
          </p>
        </div>
        <Link
          to="/voice/sessions"
          className="inline-flex items-center rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700"
        >
          View Voice Sessions
        </Link>
      </div>

      <Card title="Start Test Call">
        <form onSubmit={handleSubmit} className="max-w-xl space-y-4">
          <Input
            label="Customer mobile number"
            type="text"
            inputMode="numeric"
            autoComplete="tel"
            placeholder="9876543210 or 919876543210"
            value={customerNumber}
            onChange={(event) => setCustomerNumber(event.target.value)}
            disabled={loading}
            required
          />
          <p className="text-xs text-slate-500">
            Enter a 10 digit Indian mobile number or 91XXXXXXXXXX
          </p>

          {error && <ErrorState message={error} />}

          {result?.success && (
            <div className="rounded-lg border border-emerald-800/60 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
              <p className="font-medium">{result.message}</p>
              <p className="mt-1 text-emerald-300">
                Normalized number: {result.normalizedCustomerNumber}
              </p>
              <p className="mt-2 text-xs text-emerald-400">
                If the call connects, monitor the live session on{' '}
                <Link to="/voice/sessions" className="underline hover:text-emerald-200">
                  Voice Sessions
                </Link>
                .
              </p>
            </div>
          )}

          <Button type="submit" disabled={loading || !customerNumber.trim()}>
            {loading ? 'Starting Test Call...' : 'Start Test Call'}
          </Button>
        </form>
      </Card>

      {result?.providerResponse !== undefined && result.providerResponse !== null && (
        <Card title="Provider Response">
          <pre className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-4 text-xs text-slate-300">
            {JSON.stringify(result.providerResponse, null, 2)}
          </pre>
        </Card>
      )}
    </div>
  );
}
