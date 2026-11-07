'use client';
import { AlertTriangle, Bot, CheckCircle2, Info, Lightbulb, Send, Sparkles, TrendingUp } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MultiLine } from '@/components/charts';
import { Badge, Button, Card, CardBody, CardHeader, Input, PageHeader, Spinner } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useApi } from '@/lib/hooks';

interface Answer {
  question: string;
  intent: string;
  answer: string;
  facts: Array<{ label: string; value: string }>;
  assumptions: string[];
  confidence: 'high' | 'medium' | 'low';
  period?: { label: string };
  followUps: string[];
  disclaimer?: string;
  source: string;
}

interface Insight {
  id: string;
  type: string;
  severity: 'info' | 'positive' | 'warning' | 'critical';
  title: string;
  detail: string;
  assumptions?: string[];
}

interface Forecast {
  expenditure: { history: Array<{ month: string; expenses: string }>; forecast: Array<{ month: string; value: string; low: string; high: string }>; method: string; confidence: string };
  savings: { projection: Array<{ month: string; balance: string }>; assumptions: string[]; averageMonthlySurplus: string };
  disclaimer: string;
}

type Message = { role: 'user'; text: string } | { role: 'assistant'; answer: Answer } | { role: 'error'; text: string };

const sevIcon = { info: Info, positive: CheckCircle2, warning: AlertTriangle, critical: AlertTriangle };
const sevColor = { info: 'text-accent bg-accent/10', positive: 'text-positive bg-positive/10', warning: 'text-warning bg-warning/10', critical: 'text-negative bg-negative/10' };

export default function AssistantPage() {
  const { data: examples } = useApi<string[]>('/assistant/examples');
  const { data: insights, isLoading: insightsLoading } = useApi<{ insights: Insight[] }>('/assistant/insights');
  const { data: forecast } = useApi<Forecast>('/assistant/forecast?months=6');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), [messages]);

  async function ask(q: string) {
    if (!q.trim() || busy) return;
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setInput('');
    setBusy(true);
    try {
      const answer = await api.post<Answer>('/assistant/ask', { question: q });
      setMessages((m) => [...m, { role: 'assistant', answer }]);
    } catch (err) {
      setMessages((m) => [...m, { role: 'error', text: (err as ApiError).message }]);
    } finally {
      setBusy(false);
    }
  }

  const chartData = forecast
    ? [
        ...forecast.expenditure.history.map((h) => ({ month: h.month, actual: Number(h.expenses) })),
        ...forecast.expenditure.forecast.map((f) => ({ month: f.month, forecast: Number(f.value), low: Number(f.low), high: Number(f.high) })),
      ]
    : [];

  return (
    <div className="space-y-6">
      <PageHeader title="AI financial assistant" description="Ask about your recorded finances. Every answer shows the facts and assumptions behind it, and forecasts are estimates, never guarantees." />
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="flex h-[640px] flex-col lg:col-span-3">
          <CardHeader title="Ask Monetra" description="Rule-based and transparent: answers come only from your own records." action={<Badge tone="brand"><Sparkles className="h-3 w-3" /> Explainable</Badge>} />
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {messages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <div className="mb-3 rounded-2xl bg-brand-soft p-3 text-brand"><Bot className="h-6 w-6" /></div>
                <p className="font-medium">What would you like to know?</p>
                <div className="mt-4 flex max-w-lg flex-wrap justify-center gap-2">
                  {examples?.map((q) => (
                    <button key={q} onClick={() => ask(q)} className="rounded-full border border-border px-3 py-1.5 text-xs text-muted transition hover:border-brand hover:text-brand">{q}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) =>
              m.role === 'user' ? (
                <div key={i} className="flex justify-end"><div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand px-4 py-2 text-sm text-white dark:text-[#04201d]">{m.text}</div></div>
              ) : m.role === 'error' ? (
                <div key={i} className="text-sm text-negative">{m.text}</div>
              ) : (
                <div key={i} className="animate-in max-w-[92%] space-y-3 rounded-2xl rounded-bl-md border border-border bg-surface-2/60 p-4">
                  <p className="text-sm leading-relaxed">{m.answer.answer}</p>
                  {m.answer.facts.length > 0 && (
                    <dl className="grid gap-2 sm:grid-cols-2">
                      {m.answer.facts.map((f) => (
                        <div key={f.label} className="rounded-xl bg-surface px-3 py-2"><dt className="text-[11px] text-muted">{f.label}</dt><dd className="num text-sm font-medium">{f.value}</dd></div>
                      ))}
                    </dl>
                  )}
                  {m.answer.assumptions.length > 0 && (
                    <details className="text-xs text-muted">
                      <summary className="cursor-pointer font-medium text-text">Assumptions & method</summary>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4">{m.answer.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
                    </details>
                  )}
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
                    <Badge tone={m.answer.confidence === 'high' ? 'positive' : m.answer.confidence === 'medium' ? 'warning' : 'neutral'}>{m.answer.confidence} confidence</Badge>
                    {m.answer.period && <span>Period: {m.answer.period.label}</span>}
                    <span>{m.answer.source}</span>
                  </div>
                  {m.answer.disclaimer && <p className="text-[11px] italic text-muted">{m.answer.disclaimer}</p>}
                  {m.answer.followUps.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {m.answer.followUps.map((q) => <button key={q} onClick={() => ask(q)} className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted hover:border-brand hover:text-brand">{q}</button>)}
                    </div>
                  )}
                </div>
              ),
            )}
            {busy && <div className="flex items-center gap-2 text-sm text-muted"><Spinner className="h-4 w-4" /> Analysing your records…</div>}
            <div ref={end} />
          </div>
          <form onSubmit={(e: FormEvent) => { e.preventDefault(); ask(input); }} className="flex gap-2 border-t border-border p-4">
            <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. Can I afford a purchase of ₹50,000?" aria-label="Your question" maxLength={500} />
            <Button type="submit" disabled={!input.trim()} loading={busy} aria-label="Ask"><Send className="h-4 w-4" /></Button>
          </form>
        </Card>
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Insights for you" action={<Lightbulb className="h-4 w-4 text-warning" />} />
            <CardBody className="max-h-[360px] space-y-3 overflow-y-auto">
              {insightsLoading && <Spinner />}
              {insights?.insights.map((i) => {
                const Icon = sevIcon[i.severity];
                return (
                  <div key={i.id} className="flex gap-3">
                    <div className={cn('h-fit rounded-xl p-2', sevColor[i.severity])}><Icon className="h-4 w-4" /></div>
                    <div>
                      <p className="text-sm font-medium">{i.title}</p>
                      <p className="text-xs text-muted">{i.detail}</p>
                      {i.assumptions && <p className="mt-1 text-[11px] italic text-muted">{i.assumptions[0]}</p>}
                    </div>
                  </div>
                );
              })}
              {insights && !insights.insights.length && <p className="text-sm text-muted">Record a few weeks of income and spending to unlock insights.</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Spending forecast" description={forecast ? `${forecast.expenditure.confidence} confidence · ${forecast.expenditure.method}` : undefined} action={<TrendingUp className="h-4 w-4 text-muted" />} />
            <CardBody>
              {chartData.length > 1 ? (
                <MultiLine data={chartData} height={200} lines={[{ key: 'actual', label: 'Actual', color: '#e11d48' }, { key: 'forecast', label: 'Forecast', color: '#4f46e5', dashed: true }, { key: 'high', label: 'High', color: '#94a3b8', dashed: true }, { key: 'low', label: 'Low', color: '#94a3b8', dashed: true }]} />
              ) : (
                <p className="text-sm text-muted">Needs a few months of history.</p>
              )}
              <p className="mt-2 text-[11px] text-muted">{forecast?.disclaimer}</p>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
