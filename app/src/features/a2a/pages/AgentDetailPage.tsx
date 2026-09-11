/**
 * @file AgentDetailPage.tsx
 * @description One A2A agent: skills, capabilities, URL; start a chat or unregister it
 * @feature a2a
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Copy, MessageSquare, Trash2, Zap } from 'lucide-react';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  KeyValueList,
  PageHeader,
  Panel,
  RowActions,
  SkeletonText,
  confirm,
  toast,
} from '@/shared/components/ui';
import { getErrorMessage } from '@/shared/utils/error';
import { useA2AStore } from '../store';

const icon = 'h-4 w-4';
const back = { to: '/a2a/agents', label: 'Agents' };

function yesNo(v?: boolean): string {
  return v ? 'Yes' : 'No';
}

/**
 * Agent detail (recipe 4). Fetches the agent list on a direct load.
 */
export function AgentDetailPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const decodedName = name ? decodeURIComponent(name) : '';
  const agent = useA2AStore((s) => s.registeredAgents.find((a) => a.name === decodedName));
  const fetchAgents = useA2AStore((s) => s.fetchAgents);
  const unregisterAgent = useA2AStore((s) => s.unregisterAgent);

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(agent ? 'ready' : 'loading');
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    useA2AStore.setState({ error: null });
    await fetchAgents();
    const err = useA2AStore.getState().error;
    setLoadError(err);
    setStatus(err ? 'error' : 'ready');
  }, [fetchAgents]);

  useEffect(() => {
    if (!useA2AStore.getState().registeredAgents.some((a) => a.name === decodedName)) void load();
  }, [decodedName, load]);

  if (!agent) {
    if (status === 'loading') {
      return (
        <div className="flex flex-col gap-6">
          <PageHeader eyebrow="Operate" back={back} title={decodedName || 'Loading…'} />
          <Panel>
            <SkeletonText lines={4} />
          </Panel>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-6">
        <PageHeader eyebrow="Operate" back={back} title={decodedName || 'Agent'} />
        <Panel>
          <ErrorState
            title={status === 'error' ? "Couldn't load this agent" : "Couldn't find this agent"}
            message={
              loadError ?? 'No registered agent has this name. It may have been unregistered, or the link is wrong.'
            }
            onRetry={() => void load()}
          />
        </Panel>
      </div>
    );
  }

  const skills = agent.skills ?? [];
  const caps = agent.capabilities ?? {};

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(agent.url);
      toast.success('URL copied', { description: agent.url });
    } catch {
      toast.error("Couldn't copy the URL", { description: agent.url });
    }
  };

  const askUnregister = async () => {
    const ok = await confirm({
      title: `Unregister ${agent.name}?`,
      description: 'The server stops routing tasks to it. The robot itself keeps running.',
      confirmLabel: 'Unregister',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await unregisterAgent(agent.name);
      toast.success('Agent unregistered', { description: agent.name });
      navigate('/a2a/agents');
    } catch (err) {
      toast.error("Couldn't unregister agent", { description: getErrorMessage(err) });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Operate"
        back={back}
        title={agent.name}
        description={
          agent.description ? (
            <span className="line-clamp-2 max-w-3xl" title={agent.description}>
              {agent.description}
            </span>
          ) : undefined
        }
        meta={agent.version ? <Badge variant="neutral" size="sm">v{agent.version}</Badge> : undefined}
        actions={
          <>
            <Button variant="secondary" leftIcon={<Copy className={icon} strokeWidth={1.75} />} onClick={() => void copyUrl()}>
              Copy URL
            </Button>
            <Button
              leftIcon={<MessageSquare className={icon} strokeWidth={1.75} />}
              onClick={() => navigate(`/a2a?agent=${encodeURIComponent(agent.name)}`)}
            >
              Start chat
            </Button>
            <RowActions
              label="More actions"
              items={[{ label: 'Unregister', icon: <Trash2 />, tone: 'danger', onSelect: () => void askUnregister() }]}
            />
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel className="xl:col-span-2">
          <Panel.Header title="Skills" description={`${skills.length} skill${skills.length !== 1 ? 's' : ''} in the agent card`} />
          <Panel.Body>
            {skills.length === 0 ? (
              <EmptyState size="sm" icon={<Zap />} title="No skills listed" description="The agent card names no skills." />
            ) : (
              <ul className="flex flex-col divide-y divide-line-subtle">
                {skills.map((s) => (
                  <li key={s.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                    <div className="text-sm font-semibold text-ink-primary">{s.name}</div>
                    {s.description && <p className="text-[13px] text-ink-secondary">{s.description}</p>}
                    {s.tags && s.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {s.tags.map((t) => (
                          <Badge key={t} variant="neutral" size="sm">{t}</Badge>
                        ))}
                      </div>
                    )}
                    {s.examples && s.examples.length > 0 && (
                      <ul className="flex flex-col gap-1">
                        {s.examples.map((ex, i) => (
                          <li key={i} className="rounded-control bg-inset px-3 py-1.5 text-[13px] text-ink-secondary">
                            “{ex}”
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel.Body>
        </Panel>

        <Panel>
          <Panel.Header title="Details" />
          <Panel.Body>
            <KeyValueList
              columns={1}
              items={[
                { label: 'URL', value: agent.url, mono: true },
                { label: 'Version', value: agent.version },
                { label: 'Provider', value: agent.provider?.organization },
                { label: 'Streaming', value: yesNo(caps.streaming) },
                { label: 'Push notifications', value: yesNo(caps.pushNotifications) },
                { label: 'State history', value: yesNo(caps.stateTransitionHistory) },
                { label: 'Input modes', value: agent.defaultInputModes?.join(', ') },
                { label: 'Output modes', value: agent.defaultOutputModes?.join(', ') },
                {
                  label: 'Documentation',
                  value: agent.documentationUrl ? (
                    <a href={agent.documentationUrl} target="_blank" rel="noopener noreferrer" className="break-all text-primary hover:underline">
                      {agent.documentationUrl}
                    </a>
                  ) : undefined,
                },
              ]}
            />
          </Panel.Body>
        </Panel>
      </div>
    </div>
  );
}
