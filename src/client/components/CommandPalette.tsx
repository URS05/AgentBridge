import { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import {
  BarChart3,
  Bot,
  FileSearch,
  GitBranch,
  LayoutDashboard,
  MessageSquare,
  Play,
  Plug,
  Search,
  Settings,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import type { Journey } from '../../core/types';
import { api } from '../api';
import { humanizeStatus } from '../humanCopy';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

export function CommandPalette({
  open,
  onOpenChange,
  onNavigate,
  onOpenLaunch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (path: string) => void;
  onOpenLaunch: () => void;
}) {
  const [journeys, setJourneys] = useState<Journey[]>([]);

  useEffect(() => {
    if (!open) return;
    api.getJourneys({ pageSize: 10 }).then((d) => setJourneys(d.journeys)).catch(() => {});
  }, [open]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [open, onOpenChange]);

  const navItems = [
    { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
    { label: 'All Merchants', path: '/journeys', icon: GitBranch },
    { label: 'Approvals', path: '/approvals', icon: UserCheck },
    { label: 'Assistant Chat', path: '/chat', icon: MessageSquare },
    { label: 'A2A Analytics & Study', path: '/analytics', icon: BarChart3 },
    { label: 'Safety Checks', path: '/validation', icon: ShieldCheck },
    { label: 'AI Assistants', path: '/agents', icon: Bot },
    { label: 'Audit History', path: '/audit', icon: FileSearch },
    { label: 'Connected Systems', path: '/integrations', icon: Plug },
    { label: 'Safety Rules & Settings', path: '/settings', icon: Settings },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="p-0 overflow-hidden sm:max-w-lg bg-card border-border">
        <DialogTitle className="sr-only">Quick Search &amp; Navigation</DialogTitle>
        <Command className="w-full text-foreground">
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border">
            <Search className="w-4 h-4 text-muted-foreground shrink-0" />
            <Command.Input
              autoFocus
              placeholder="Search merchants, pages, or actions..."
              className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
          <Command.List className="max-h-80 overflow-y-auto p-2 space-y-2">
            <Command.Empty className="py-6 text-center text-xs text-muted-foreground">
              No matching merchant or page found.
            </Command.Empty>

            <Command.Group heading="Quick Actions" className="text-[11px] font-medium text-muted-foreground px-2">
              <Command.Item
                onSelect={() => {
                  onOpenChange(false);
                  onOpenLaunch();
                }}
                className="flex items-center gap-2.5 px-3 py-2 mt-1 rounded-lg text-xs text-foreground cursor-pointer aria-selected:bg-secondary"
              >
                <Play className="w-3.5 h-3.5 text-[#0095D9] dark:text-[#00B9F1]" />
                <span>Start New Merchant Onboarding</span>
              </Command.Item>
            </Command.Group>

            <Command.Group heading="Pages" className="text-[11px] font-medium text-muted-foreground px-2">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Command.Item
                    key={item.path}
                    onSelect={() => {
                      onNavigate(item.path);
                      onOpenChange(false);
                    }}
                    className="flex items-center gap-2.5 px-3 py-2 mt-0.5 rounded-lg text-xs text-foreground cursor-pointer aria-selected:bg-secondary"
                  >
                    <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                    <span>{item.label}</span>
                  </Command.Item>
                );
              })}
            </Command.Group>

            {journeys.length > 0 && (
              <Command.Group heading="Merchants" className="text-[11px] font-medium text-muted-foreground px-2">
                {journeys.slice(0, 8).map((j) => (
                  <Command.Item
                    key={j.id}
                    value={`${j.id} ${j.externalReference} ${j.merchantName} ${j.status}`}
                    onSelect={() => {
                      onNavigate(`/journeys/${j.id}`);
                      onOpenChange(false);
                    }}
                    className="flex items-center justify-between gap-2 px-3 py-2 mt-0.5 rounded-lg text-xs text-foreground cursor-pointer aria-selected:bg-secondary"
                  >
                    <span className="truncate font-medium">{j.merchantName}</span>
                    <span className="text-[11px] text-muted-foreground shrink-0">{humanizeStatus(j.status)}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
