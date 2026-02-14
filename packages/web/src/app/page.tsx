'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent } from '@/components/ui/Card';
import { Separator } from '@/components/ui/Separator';
import {
  Terminal,
  Github,
  Zap,
  Plug,
  BrainCircuit,
  Copy,
  Check,
  Sparkles,
  ArrowRight,
} from 'lucide-react';

const REPO = 'https://github.com/hasna/assistants';

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 font-mono text-sm">
      <span className="text-muted-foreground select-none">$</span>
      <code className="flex-1">{code}</code>
      <button onClick={copy} className="text-muted-foreground hover:text-foreground transition-colors" aria-label="Copy">
        {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}

const features = [
  { icon: Terminal, title: 'Terminal-native', desc: 'Rich Ink-powered UI right in your terminal.' },
  { icon: Plug, title: 'Connector bridge', desc: 'Notion, Gmail, Google Drive — plug in any CLI connector.' },
  { icon: BrainCircuit, title: 'Skills & hooks', desc: 'Extend with SKILL.md files. Hook into every lifecycle.' },
  { icon: Zap, title: 'Bun-powered', desc: 'Instant startup, sub-second tool execution.' },
];

export default function LandingPage() {
  const [email, setEmail] = useState('');
  const [subscribed, setSubscribed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (res.ok) setSubscribed(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-lg">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <Terminal className="h-5 w-5 text-primary" />
            <span className="font-[family-name:var(--font-display)] text-lg font-semibold">assistants</span>
          </div>
          <div className="flex items-center gap-2">
            <a href={REPO} target="_blank" rel="noopener noreferrer">
              <Button variant="ghost" size="sm"><Github className="h-4 w-4" /></Button>
            </a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-4xl px-6 pt-24 pb-20 text-center">
        <Badge className="mb-6"><Sparkles className="mr-1.5 h-3 w-3" />Open source</Badge>

        <h1 className="font-[family-name:var(--font-display)] text-5xl font-bold tracking-tight sm:text-6xl">
          Your AI assistant,<br />
          <span className="text-primary">in the terminal.</span>
        </h1>

        <p className="mx-auto mt-6 max-w-lg text-lg text-muted-foreground">
          A personal AI assistant that connects to your tools and extends
          with skills and hooks. Like Claude Code, but yours.
        </p>

        <div className="mx-auto mt-10 max-w-sm">
          <CodeBlock code="bun add -g @hasna/assistants" />
        </div>

        <div className="mt-8 flex justify-center gap-3">
          <a href={REPO} target="_blank" rel="noopener noreferrer">
            <Button size="lg" className="gap-2"><Github className="h-4 w-4" />GitHub</Button>
          </a>
          <a href="#subscribe">
            <Button variant="outline" size="lg" className="gap-2">Subscribe<ArrowRight className="h-4 w-4" /></Button>
          </a>
        </div>
      </section>

      {/* Terminal preview */}
      <section className="mx-auto max-w-2xl px-6 pb-20">
        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
            <div className="h-2.5 w-2.5 rounded-full bg-red-400" />
            <div className="h-2.5 w-2.5 rounded-full bg-amber-400" />
            <div className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
            <span className="ml-2 text-xs text-muted-foreground">assistants</span>
          </div>
          <CardContent className="p-5 pt-5 font-mono text-sm leading-relaxed">
            <p className="text-muted-foreground">$ assistants</p>
            <p className="mt-2"><span className="text-primary">assistants</span> <span className="text-muted-foreground">v0.1.0</span></p>
            <p className="mt-3 text-muted-foreground">{'>'} 3 connectors: <span className="text-foreground">notion, gmail, googledrive</span></p>
            <p className="text-muted-foreground">{'>'} 5 skills loaded</p>
            <p className="text-muted-foreground">{'>'} hooks ready</p>
            <p className="mt-3">
              <span className="text-emerald-500">? </span>
              How can I help?
              <span className="ml-1 inline-block h-4 w-1.5 animate-pulse bg-primary" />
            </p>
          </CardContent>
        </Card>
      </section>

      <Separator />

      {/* Features */}
      <section className="mx-auto max-w-4xl px-6 py-20">
        <h2 className="text-center font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight">Built for developers</h2>
        <p className="mt-3 text-center text-muted-foreground">Everything you need for an AI-powered workflow.</p>

        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {features.map((f) => (
            <Card key={f.title} className="transition-shadow hover:shadow-md">
              <CardContent className="flex items-start gap-4 p-5">
                <div className="rounded-lg bg-primary/10 p-2">
                  <f.icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-[family-name:var(--font-display)] font-semibold">{f.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{f.desc}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <Separator />

      {/* Install steps */}
      <section className="mx-auto max-w-4xl px-6 py-20">
        <h2 className="text-center font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight">Get started in seconds</h2>
        <div className="mx-auto mt-10 max-w-md space-y-4">
          {[
            { n: '1', label: 'Install globally', cmd: 'bun add -g @hasna/assistants' },
            { n: '2', label: 'Set your API key', cmd: 'export ANTHROPIC_API_KEY="sk-..."' },
            { n: '3', label: 'Run it', cmd: 'assistants' },
          ].map((s) => (
            <div key={s.n} className="flex items-start gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{s.n}</span>
              <div className="flex-1">
                <p className="mb-1.5 text-sm font-medium">{s.label}</p>
                <CodeBlock code={s.cmd} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <Separator />

      {/* Subscribe */}
      <section id="subscribe" className="mx-auto max-w-4xl px-6 py-20 text-center">
        <h2 className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight">Something hot is coming</h2>
        <p className="mt-3 text-muted-foreground">Be the first to know when it drops.</p>

        {subscribed ? (
          <p className="mt-8 flex items-center justify-center gap-2 text-emerald-600 font-medium">
            <Check className="h-5 w-5" /> You&apos;re in! We&apos;ll be in touch.
          </p>
        ) : (
          <form
            onSubmit={handleSubscribe}
            className="mx-auto mt-8 flex max-w-xs gap-2"
          >
            <Input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={submitting}
            />
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving...' : 'Subscribe'}
            </Button>
          </form>
        )}
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-6">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5"><Terminal className="h-3.5 w-3.5" />assistants</span>
          <div className="flex items-center gap-4">
            <a href={REPO} target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">GitHub</a>
            <span>&copy; {new Date().getFullYear()} Hasna</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
