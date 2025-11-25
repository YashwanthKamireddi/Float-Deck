// This is the final, integrated version of your chat interface.
// It connects the beautiful UI to the powerful RAG AI backend.

import { useState, useEffect, useRef, useCallback } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ChevronRight, Send, Bot, User, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

// --- CORE INTEGRATION ---
// 1. Import the real API function and its response type.
import { askAI, AIResponse } from '@/services/api';

interface GuidedSummary {
  signature: string;
  headline: string;
  highlights: string[];
  columns: string[];
  sampleFloat?: string;
}

// --- Define the shape of our chat messages ---
interface Message {
  id: string;
  content: string;
  sender: 'user' | 'assistant';
  timestamp: Date;
  type?: string;
  title?: string;
  metadata?: Record<string, any>;
}

type BackendStatus = "operational" | "degraded" | "offline";

interface ChatInterfaceProps {
  // This function will pass the REAL data up to the main dashboard
  onDataReceived: (data: Record<string, any>[], sqlQuery: string) => void;
  onComplexitySignal: (delta: number, query: string) => void;
  dataSummary: GuidedSummary | null;
  palettePrefill: string | null;
  onPrefillConsumed: () => void;
  onBackendStatusChange?: (status: BackendStatus, detail?: string) => void;
  variant?: "full" | "tray";
}

const SUGGESTIONS: Array<{ label: string; prompt: string; tone: "data" | "ops" | "narrative" }> = [
  {
    label: "Latest active floats",
    prompt: "List the latest positions for 50 active floats with float_id, latitude, longitude, and last contact date.",
    tone: "data",
  },
  {
    label: "Profile snapshot",
    prompt: "Show the most recent temperature profile for float 5905612 with depth and temperature.",
    tone: "data",
  },
  {
    label: "Fleet health",
    prompt: "Summarize total floats, active vs delayed counts, and last ingest time.",
    tone: "ops",
  },
  {
    label: "North Atlantic slice",
    prompt: "Give temperature and salinity averages for floats between 20N and 60N, -80W to 10E over the last 30 days.",
    tone: "data",
  },
  {
    label: "Explain FloatAI",
    prompt: "What does this dashboard do and how should I start exploring the data?",
    tone: "narrative",
  },
];

const buildWelcomeMessage = (): Message => ({
  id: `welcome-${Date.now()}`,
  content: `Welcome to FloatAI — your ARGO mission copilot.
Ask a question to surface floats, profiles, or trends when you're ready.`,
  sender: 'assistant',
  timestamp: new Date(),
});

const formatRelativeTime = (date: Date | null | undefined) => {
  if (!date) return 'pending';

  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSeconds = Math.round(diffMs / 1000);

  if (diffSeconds < 10) return 'just now';
  if (diffSeconds < 60) return `${diffSeconds}s ago`;

  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const evaluateComplexity = (query: string) => {
  const normalized = query.toLowerCase();
  let score = 0;

  const advancedKeywords = /(join|window|rank|dense_rank|correl|regression|cluster|anomal|fourier|decomposition|kalman|wavelet|predict)/;
  const analyticKeywords = /(avg|sum|count|variance|stddev|percentile|median|quantile|lag|lead|partition|group by|order by)/;
  const conditionalPatterns = /(>=|<=|!=| like | between | in \(|case when)/;
  const geospatialPatterns = /(polygon|bbox|buffer|distance|geography|geospatial|haversine)/;

  if (advancedKeywords.test(normalized)) score += 4;
  if (analyticKeywords.test(normalized)) score += 2;
  if (conditionalPatterns.test(normalized)) score += 1;
  if (geospatialPatterns.test(normalized)) score += 2;
  if (normalized.length > 140) score += 2;
  if ((normalized.match(/[()]/g) || []).length > 4) score += 1;

  return score;
};

const classifyComplexity = (score: number) => {
  if (score >= 6) return { delta: 3, classification: 'advanced' as const };
  if (score >= 4) return { delta: 2, classification: 'intermediate' as const };
  if (score >= 2) return { delta: 1, classification: 'intermediate' as const };
  if (score >= 1) return { delta: 1, classification: 'basic' as const };
  return { delta: -1, classification: 'basic' as const };
};

const extractMessageContent = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object' && 'text' in value && typeof (value as { text?: string }).text === 'string') {
    return (value as { text: string }).text;
  }
  return '';
};

const normalizeAssistantMessages = (payload: AIResponse, fallbackText: string): Message[] => {
  const timestampSeed = Date.now();
  const baseMetadata =
    payload && typeof payload.metadata === 'object' && payload.metadata !== null && !Array.isArray(payload.metadata)
      ? (payload.metadata as Record<string, any>)
      : {};
  const rawMessages = Array.isArray(payload.messages) ? payload.messages : [];

  if (rawMessages.length > 0) {
    return rawMessages
      .filter((entry) => entry && entry.role === 'assistant')
      .map((entry, index) => {
        const derivedContentRaw = extractMessageContent(entry.content);
        const derivedContent = derivedContentRaw?.trim() ? derivedContentRaw.trim() : fallbackText;
        const entryMetadata =
          entry && typeof entry.metadata === 'object' && entry.metadata !== null && !Array.isArray(entry.metadata)
            ? (entry.metadata as Record<string, any>)
            : {};
        return {
          id: `assistant-${timestampSeed}-${index}`,
          sender: 'assistant',
          content: derivedContent,
          title: entry.title ?? undefined,
          type: entry.type ?? undefined,
          metadata: { ...baseMetadata, ...entryMetadata },
          timestamp: new Date(timestampSeed + index),
        };
      });
  }

  const fallbackContent = (() => {
    const normalizedFallback = typeof fallbackText === 'string' ? fallbackText.trim() : '';
    if (normalizedFallback) return normalizedFallback;
    if (typeof payload.result_data === 'string') {
      const normalizedResult = payload.result_data.trim();
      if (normalizedResult) return normalizedResult;
    }
    if (payload.error) return `An error occurred: ${payload.error}`;
    return "I'm still processing that—please try again.";
  })();

  return [
    {
      id: `assistant-${timestampSeed}`,
      sender: 'assistant',
      content: fallbackContent,
      type: payload.error ? 'error' : 'text',
      metadata: baseMetadata,
      timestamp: new Date(timestampSeed),
    },
  ];
};

const ChatInterface = ({
  onDataReceived,
  onComplexitySignal,
  dataSummary,
  palettePrefill,
  onPrefillConsumed,
  onBackendStatusChange = () => {},
  variant = "full",
}: ChatInterfaceProps) => {
  const isTray = variant === "tray";
  const [messages, setMessages] = useState<Message[]>(() => [buildWelcomeMessage()]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [isViewportReady, setIsViewportReady] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const summarySignatureRef = useRef<string | null>(null);
  const sessionIdRef = useRef(0);
  const messageCountRef = useRef(0);
  const composerRef = useRef<HTMLFormElement>(null);
  const [composerHeight, setComposerHeight] = useState(0);
  const bottomSafePadding = Math.max(72, Math.round(composerHeight * 0.45));
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showNewMessagesBadge, setShowNewMessagesBadge] = useState(false);
  const ensureChatPadding = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const paddingValue = `${bottomSafePadding}px`;
    viewport.style.setProperty('--chat-bottom-padding', paddingValue);
    viewport.style.setProperty('padding-bottom', paddingValue, 'important');
  }, [bottomSafePadding]);

  useEffect(() => {
    if (!scrollAreaRef.current) return;
    const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]') as HTMLDivElement | null;
    if (!viewport) return;

    viewportRef.current = viewport;
    setIsViewportReady(true);

    const handleScroll = () => {
      if (!viewportRef.current) return;
      const { scrollTop, scrollHeight, clientHeight } = viewportRef.current;
      const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
      const atBottom = distanceFromBottom <= 16;

      setIsAtBottom(atBottom);
      if (atBottom) {
        setShowNewMessagesBadge(false);
      }
    };

    handleScroll();
    viewport.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      viewport.removeEventListener('scroll', handleScroll);
      viewportRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!isViewportReady) return;
    ensureChatPadding();
  }, [isViewportReady, ensureChatPadding]);

  useEffect(() => {
    if (!isViewportReady) return;
    const viewport = viewportRef.current;
    if (!viewport) return;

    const observer = new MutationObserver(() => {
      ensureChatPadding();
    });

    observer.observe(viewport, { childList: true, subtree: true, attributes: true });

    return () => observer.disconnect();
  }, [isViewportReady, ensureChatPadding]);

  const scrollToBottom = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    requestAnimationFrame(() => {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
    });
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const messageAdded = messages.length > messageCountRef.current;

    if (messageAdded) {
      if (isAtBottom) {
        scrollToBottom();
      } else {
        setShowNewMessagesBadge(true);
      }
    }

    messageCountRef.current = messages.length;
  }, [messages, isAtBottom, scrollToBottom]);

  useEffect(() => {
    if (!palettePrefill) return;
    setInput(palettePrefill);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    onPrefillConsumed();
  }, [palettePrefill, onPrefillConsumed]);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.overflowY = 'hidden';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [input]);

  useEffect(() => {
    if (typeof window === 'undefined' || !composerRef.current) return;

    const updateHeight = () => {
      if (!composerRef.current) return;
      const nextHeight = composerRef.current.offsetHeight;
      setComposerHeight((prev) => (prev !== nextHeight ? nextHeight : prev));
    };

    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(composerRef.current);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!dataSummary) return;
    if (dataSummary.signature === summarySignatureRef.current) return;
    summarySignatureRef.current = dataSummary.signature;

    const summaryMessage: Message = {
      id: `${Date.now()}-summary`,
      content: `Here’s what I’m seeing:

• ${dataSummary.headline}
${dataSummary.highlights.map((line) => `• ${line}`).join('\n')}

Let me know if you’d like to dive into any detail further or filter this view.`,
      sender: 'assistant',
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, summaryMessage]);
  }, [dataSummary]);

  const sendPrompt = async (prompt: string, options?: { preserveInput?: boolean }) => {
    const trimmed = prompt.trim();
    if (!trimmed || isLoading) return;

    const currentSessionId = sessionIdRef.current;
    const timestamp = new Date();
    const userMessage: Message = {
      id: timestamp.getTime().toString(),
      content: trimmed,
      sender: 'user',
      timestamp,
      type: 'text',
    };

    setMessages((prev) => [...prev, userMessage]);

    if (!options?.preserveInput) {
      setInput('');
    }

    const score = evaluateComplexity(trimmed);
    const { delta } = classifyComplexity(score);
    onComplexitySignal(delta, trimmed);

    setIsLoading(true);

    try {
      const response: AIResponse = await askAI(trimmed);

      if (sessionIdRef.current !== currentSessionId) {
        return;
      }

      let fallbackContent = 'Sorry, I encountered an issue.';

      if (response.error) {
        fallbackContent = `An error occurred: ${response.error}`;
        onDataReceived([], response.sql_query || 'Error executing query.');
        onBackendStatusChange('degraded', response.error);
      } else if (Array.isArray(response.result_data)) {
        const data = response.result_data;
        if (data && data.length > 0) {
          fallbackContent = `I pulled ${data.length} records and synced them with the main viewscreen.`;
          onDataReceived(data, response.sql_query || '');
          onBackendStatusChange('operational', `Synced ${data.length} records.`);
        } else {
          fallbackContent = 'The query ran successfully but returned no rows. Adjust your parameters and try again.';
          onDataReceived([], response.sql_query || '');
          onBackendStatusChange('degraded', 'Query returned no rows.');
        }
      } else if (typeof response.result_data === 'string' && response.result_data.trim()) {
        fallbackContent = response.result_data.trim();
        onBackendStatusChange('operational', 'Assistant responded with narrative guidance.');
      } else {
        fallbackContent = "I'm not sure how to answer that.";
        onBackendStatusChange('degraded', 'Assistant could not determine an answer.');
      }

      let assistantMessages: Message[];
      try {
        assistantMessages = normalizeAssistantMessages(response, fallbackContent);
      } catch (normalizationError) {
        console.error('Failed to normalize assistant messages:', normalizationError);
        assistantMessages = [
          {
            id: `${Date.now()}-assistant-fallback`,
            sender: 'assistant',
            content: fallbackContent,
            type: response.error ? 'error' : 'text',
            metadata: typeof response.metadata === 'object' && response.metadata !== null ? response.metadata : undefined,
            timestamp: new Date(),
          },
        ];
      }

      setMessages((prev) => [...prev, ...assistantMessages]);
    } catch (error) {
      console.error('Chat error:', error);
      if (sessionIdRef.current !== currentSessionId) {
        return;
      }
      const errorMessage: Message = {
        id: `${Date.now()}-error`,
        content: 'Failed to connect to the AI server. Please make sure it is running.',
        sender: 'assistant',
        timestamp: new Date(),
        type: 'error',
      };
      setMessages((prev) => [...prev, errorMessage]);
      onBackendStatusChange('offline', 'Unable to reach the backend.');
    } finally {
      if (sessionIdRef.current === currentSessionId) {
        setIsLoading(false);
      }
    }
  };

  const handleSend = () => sendPrompt(input);

  const handleComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendPrompt(input);
    }
  };

  const assistantMessages = messages.filter((message) => message.sender === 'assistant' && !message.id.startsWith('welcome'));
  const userMessageCount = messages.reduce((count, message) => (message.sender === 'user' ? count + 1 : count), 0);
  const assistantMessageCount = assistantMessages.length;
  const lastAssistantTimestamp = assistantMessages.length
    ? assistantMessages[assistantMessages.length - 1].timestamp
    : null;
  const lastUserTimestamp = (() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].sender === 'user') {
        return messages[index].timestamp;
      }
    }
    return null;
  })();
  const latestInteraction = lastAssistantTimestamp ?? lastUserTimestamp;

  const updatedLabel = (() => {
    const label = formatRelativeTime(latestInteraction);
    return label === 'pending' ? '—' : label;
  })();

  const sessionTagline = (() => {
    if (dataSummary?.headline) {
      const headline = dataSummary.headline.trim();
      return headline.length > 96 ? `${headline.slice(0, 93)}…` : headline;
    }
    if (assistantMessageCount > 0) {
      return `Latest insight ${formatRelativeTime(lastAssistantTimestamp)}`;
    }
    if (userMessageCount > 0) {
      return `Waiting on results • Last prompt ${formatRelativeTime(lastUserTimestamp)}`;
    }
    return 'Mission feed idle — send a prompt to begin.';
  })();

  const statChips: { label: string; value: string }[] = [
    { label: 'Updated', value: updatedLabel },
    { label: 'Prompts', value: userMessageCount.toString() },
    { label: 'Insights', value: assistantMessageCount.toString() },
  ];

  if (dataSummary?.columns?.length) {
    statChips.push({ label: 'Fields', value: dataSummary.columns.length.toString() });
  }

  if (dataSummary?.sampleFloat !== undefined && dataSummary?.sampleFloat !== null) {
    const sampleFloatRaw = dataSummary.sampleFloat;
    const sampleFloat = typeof sampleFloatRaw === 'string'
      ? sampleFloatRaw.trim()
      : String(sampleFloatRaw).trim();

    if (sampleFloat) {
      const displayValue = sampleFloat.length > 18 ? `${sampleFloat.slice(0, 17)}…` : sampleFloat;
      statChips.push({ label: 'Sample float', value: displayValue });
    }
  }

  const handleResetConversation = useCallback(() => {
    sessionIdRef.current += 1;
    const welcomeMessage = buildWelcomeMessage();
    setMessages([welcomeMessage]);
    setInput('');
    setShowNewMessagesBadge(false);
    setIsAtBottom(true);
    setIsLoading(false);
    messageCountRef.current = 1;
    summarySignatureRef.current = null;
    onDataReceived([], '');
    onBackendStatusChange('operational', 'Chat console reset.');
    requestAnimationFrame(() => {
      scrollToBottom();
    });
  }, [onDataReceived, onBackendStatusChange, scrollToBottom]);

    const visibleStatChips = isTray ? statChips.slice(0, 2) : statChips;

  return (
    <div className={`flex h-full min-h-0 flex-col ${isTray ? "gap-2.5 text-[0.95rem]" : "gap-5 text-sm"}`}>
      <header className={`shrink-0 rounded-2xl border border-white/20 ${isTray ? "bg-white/90 px-3.5 py-2" : "bg-white/70 px-5 py-3"} shadow-[0_16px_32px_-28px_rgba(15,23,42,0.35)] backdrop-blur-md dark:border-white/10 ${isTray ? "dark:bg-slate-900/80" : "dark:bg-white/[0.05]"}`}>
        <div className={`flex flex-wrap items-center justify-between ${isTray ? "gap-3" : "gap-4"}`}>
          <div className="flex items-center gap-3">
            <div className={`flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-ocean text-white shadow-md shadow-sky-500/30 ${isTray ? "shrink-0" : ""}`}>
              <Bot className="h-4 w-4" />
            </div>
            <div className="min-w-[160px]">
              <h3 className="text-sm font-semibold leading-tight">FloatAI</h3>
              <p className="text-[0.7rem] text-muted-foreground line-clamp-1">{sessionTagline}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {visibleStatChips.map((chip) => (
              <div
                key={`${chip.label}-${chip.value}`}
                className="flex h-8 items-center gap-2 rounded-xl border border-white/30 bg-white/70 px-3 text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-slate-600 shadow-sm shadow-slate-400/10 dark:border-white/10 dark:bg-white/[0.08] dark:text-slate-200"
              >
                <span className="opacity-70">{chip.label}</span>
                <span className="tracking-normal">{chip.value}</span>
              </div>
            ))}

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-xl border border-white/30 bg-white/60 px-3 text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-slate-600 shadow-sm hover:-translate-y-0.5 hover:border-white/60 hover:bg-white/80 dark:border-white/10 dark:bg-white/[0.08] dark:text-slate-100"
              onClick={handleResetConversation}
              disabled={isLoading}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
          </div>
        </div>
      </header>

      <div className="relative flex-1 min-h-0">
        <ScrollArea
          ref={scrollAreaRef}
          className={cn(
            "data-scroll h-full flex-1 rounded-[24px]",
            isTray ? "max-h-[70vh]" : "max-h-[calc(100vh-260px)]",
            isTray
              ? "border border-white/10 bg-white/20 p-3.5 shadow-[0_18px_36px_-28px_rgba(15,23,42,0.45)] backdrop-blur-sm dark:border-white/[0.08] dark:bg-white/[0.06]"
              : "border border-white/20 bg-white/55 p-5 shadow-[0_34px_68px_-42px_rgba(15,23,42,0.55)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04]"
          )}
        >
          <div
            className={`flex flex-col ${isTray ? "gap-4 pr-4" : "gap-6 pr-6 sm:pr-8"}`}
            style={{ paddingBottom: `${bottomSafePadding}px` }}
          >
            {messages.map((message) => {
              const isUser = message.sender === 'user';
              const isSql = message.type === 'sql';
              const isError = message.type === 'error';
              const contentClassName = cn(
                'whitespace-pre-wrap break-words text-sm leading-relaxed text-left',
                isSql && 'font-mono text-[0.85rem]',
                isError && 'text-red-600 dark:text-red-300'
              );

              return (
                <div
                  key={message.id}
                  className={cn('flex w-full', isUser ? 'justify-end' : 'justify-start')}
                >
                  <div
                    className={cn(
                      'flex max-w-[min(760px,calc(100%-1.75rem))] items-end gap-3 sm:gap-4',
                      isUser ? 'flex-row-reverse text-right' : 'flex-row text-left'
                    )}
                  >
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarFallback className={isUser ? 'bg-primary text-primary-foreground shadow-[0_10px_25px_-15px_rgba(14,165,233,0.7)]' : 'bg-secondary/70 text-slate-700 dark:bg-white/[0.08] dark:text-white'}>
                        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                      </AvatarFallback>
                    </Avatar>

                    <div
                      className={cn(
                        'relative inline-flex w-fit max-w-[min(700px,calc(100%-2.5rem))] flex-col overflow-hidden rounded-2xl px-4 py-3 text-left shadow transition-shadow',
                        isUser
                          ? 'bg-primary text-primary-foreground shadow-lg shadow-sky-500/30'
                          : 'bg-white/90 text-slate-700 shadow-[0_22px_48px_-32px_rgba(15,23,42,0.55)] backdrop-blur-lg dark:bg-white/[0.08] dark:text-slate-100'
                      )}
                    >
                      {!isUser && message.title && (
                        <p className="mb-1 text-[0.65rem] uppercase tracking-[0.24em] text-slate-500 dark:text-slate-300">
                          {message.title}
                        </p>
                      )}
                      <p className={contentClassName}>{message.content}</p>
                    </div>
                  </div>
                </div>
              );
            })}

            {isLoading && (
              <div className="flex w-full justify-start">
                <div className="flex max-w-[min(760px,calc(100%-1.75rem))] items-end gap-3 sm:gap-4">
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarFallback className="bg-secondary/70 text-slate-700 dark:bg-white/[0.08] dark:text-white">
                      <Bot className="h-4 w-4" />
                    </AvatarFallback>
                  </Avatar>
                  <div className="inline-flex w-fit max-w-[min(700px,calc(100%-2.5rem))] flex-col rounded-2xl bg-white/90 px-4 py-3 shadow-[0_22px_48px_-32px_rgba(15,23,42,0.55)] backdrop-blur-lg dark:bg-white/[0.08]">
                    <div className="flex items-center gap-3 text-slate-600 dark:text-slate-200" aria-live="polite">
                      <span className="control-label text-[0.58rem] opacity-70">Drafting</span>
                      <span className="sr-only">Assistant is typing</span>
                      <div className="flex items-center gap-1.5" aria-hidden="true">
                        <span className="typing-dot" style={{ animationDelay: '0ms' }} />
                        <span className="typing-dot" style={{ animationDelay: '0.14s' }} />
                        <span className="typing-dot" style={{ animationDelay: '0.28s' }} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {showNewMessagesBadge && (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 z-50 flex justify-center">
            <button
              type="button"
              onClick={() => {
                scrollToBottom();
                setShowNewMessagesBadge(false);
              }}
              className="pointer-events-auto inline-flex items-center gap-2 rounded-full border-2 border-white/40 bg-gradient-to-br from-sky-600 to-indigo-600 px-5 py-2.5 text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-white shadow-[0_12px_28px_-8px_rgba(14,165,233,0.6)] backdrop-blur-sm transition-all duration-300 hover:scale-105 hover:shadow-[0_16px_36px_-6px_rgba(14,165,233,0.7)] active:scale-95 dark:border-white/20"
            >
              New message
              <ChevronRight className="h-3.5 w-3.5 rotate-90" />
            </button>
          </div>
        )}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          handleSend();
        }}
        ref={composerRef}
        className={`shrink-0 rounded-[24px] border border-white/20 bg-white/70 ${isTray ? "px-3.5 py-3" : "px-5 py-4"} shadow-[0_22px_44px_-35px_rgba(15,23,42,0.4)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.05]`}
      >
        {!isTray && (
          <div className="mb-4 flex flex-wrap items-center gap-2 text-[0.65rem] uppercase tracking-[0.32em] text-slate-500 dark:text-slate-300">
            <span>Chat Composer</span>
          </div>
        )}
        {!isTray && (
          <div className="mb-3 grid gap-2 sm:grid-cols-2">
            {SUGGESTIONS.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  setInput(item.prompt);
                  requestAnimationFrame(() => inputRef.current?.focus());
                }}
                className="group inline-flex items-center justify-between rounded-2xl border border-white/30 bg-white/70 px-4 py-2.5 text-left text-sm font-semibold text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-white/60 hover:shadow-[0_14px_36px_-26px_rgba(15,23,42,0.5)] dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-100"
              >
                <span className="pr-3">{item.label}</span>
                <span
                  className={`rounded-full px-3 py-1 text-[0.65rem] uppercase tracking-[0.26em] ${
                    item.tone === "data"
                      ? "bg-sky-500/15 text-sky-200"
                      : item.tone === "ops"
                        ? "bg-emerald-500/15 text-emerald-200"
                        : "bg-indigo-500/15 text-indigo-200"
                  }`}
                >
                  {item.tone === "data" ? "Data" : item.tone === "ops" ? "Ops" : "Guide"}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-3">
          <div className={`relative flex ${isTray ? "min-h-[90px]" : "min-h-[125px]"} flex-1 rounded-[28px] bg-white/95 px-4 py-3 shadow-[0_24px_50px_-36px_rgba(15,23,42,0.45)] transition-all duration-200 dark:bg-white/[0.07]`}>
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="Ask a question or issue a directive..."
              rows={1}
              className="w-full resize-none border-none bg-transparent pr-14 text-base leading-relaxed tracking-tight text-slate-700 outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 dark:text-slate-100"
              disabled={isLoading}
              ref={inputRef}
              aria-label="Chat composer"
            />
            <Button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="absolute bottom-3 right-3 flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 via-indigo-500 to-purple-500 shadow-lg shadow-sky-500/25 transition hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 disabled:cursor-not-allowed"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
};

export default ChatInterface;
