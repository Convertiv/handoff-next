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
      router.push(`${basePath}/system/workbench`);
      onClose?.();
    }
  };

  const { icon, label, sublabel } = resolveAction(action);

  return (
    <button
      type="button"
      onClick={handleClick}
      className="mt-2 flex w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/60 active:bg-muted"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium leading-tight">{label}</p>
        {sublabel && <p className="truncate text-xs text-muted-foreground">{sublabel}</p>}
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function resolveAction(action: ChatAction): { icon: React.ReactNode; label: string; sublabel?: string } {
  switch (action.type) {
    case 'navigate_component':
      return {
        icon: <Layers className="h-4 w-4" />,
        label: action.title,
        sublabel: 'View component',
      };
    case 'navigate_pattern':
      return {
        icon: <LayoutTemplate className="h-4 w-4" />,
        label: action.title,
        sublabel: 'View pattern',
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
        sublabel: action.description,
      };
  }
}
