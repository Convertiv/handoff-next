'use client';

import { ArrowRight, Layers, LayoutTemplate, PanelRight, Wrench } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { ChatAction } from './ChatContext';

interface Props {
  action: ChatAction;
  basePath?: string;
  onClose?: () => void;
}

export function ChatActionCard({ action, basePath = '', onClose }: Props) {
  const router = useRouter();

  const handleClick = () => {
    if (action.type === 'navigate_component') {
      router.push(`${basePath}/system/component/${encodeURIComponent(action.id)}`);
      onClose?.();
    } else if (action.type === 'navigate_pattern') {
      router.push(`${basePath}/system/pattern/${encodeURIComponent(action.id)}`);
      onClose?.();
    } else if (action.type === 'open_playground') {
      router.push(`${basePath}/system/playground`);
      onClose?.();
    } else if (action.type === 'open_design_workbench') {
      const params = new URLSearchParams();
      if (action.componentId) params.set('component', action.componentId);
      if (action.generationPrompt) params.set('prompt', action.generationPrompt);
      const qs = params.toString();
      router.push(`${basePath}/design${qs ? `?${qs}` : ''}`);
      onClose?.();
    }
  };

  const { icon, label, sublabel } = resolveAction(action, basePath);

  return (
    <button
      type="button"
      onClick={handleClick}
      className="mt-1 flex w-full items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/60 active:bg-muted"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium leading-tight">{label}</p>
        {sublabel && <p className="line-clamp-2 text-xs text-muted-foreground">{sublabel}</p>}
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function resolveAction(
  action: ChatAction,
  _basePath: string
): { icon: React.ReactNode; label: string; sublabel?: string } {
  switch (action.type) {
    case 'navigate_component':
      return {
        icon: <Layers className="h-4 w-4" />,
        label: action.title,
        sublabel: action.reason ?? 'View component',
      };
    case 'navigate_pattern':
      return {
        icon: <LayoutTemplate className="h-4 w-4" />,
        label: action.title,
        sublabel: action.reason ?? 'View pattern',
      };
    case 'open_playground':
      return {
        icon: <PanelRight className="h-4 w-4" />,
        label: 'Open Playground',
        sublabel: action.description,
      };
    case 'open_design_workbench':
      return {
        icon: <Wrench className="h-4 w-4" />,
        label: 'Open Design Workbench',
        sublabel: action.generationPrompt
          ? `"${action.generationPrompt.slice(0, 80)}${action.generationPrompt.length > 80 ? '…' : ''}"`
          : action.description,
      };
    case 'show_components':
      // show_components is rendered as a grid, not a card — this branch is unreachable
      return { icon: <Layers className="h-4 w-4" />, label: 'Components' };
  }
}
