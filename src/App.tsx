import { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  Bot,
  ChevronDown,
  ChevronRight,
  FileSearch,
  GitBranch,
  LayoutDashboard,
  Menu,
  MessageSquare,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  UserCheck,
} from 'lucide-react';
import { Toaster } from 'sonner';
import { api, subscribeWorkflowEvents, type OverviewResponse } from './client/api';
import { CommandPalette } from './client/components/CommandPalette';
import { FloatingPaytmBot } from './client/components/FloatingPaytmBot';
import { LaunchJourneyModal } from './client/components/LaunchJourneyModal';
import { OverviewView } from './client/views/OverviewView';
import { ChatView } from './client/views/ChatView';
import { JourneysView } from './client/views/JourneysView';
import { JourneyDetailView } from './client/views/JourneyDetailView';
import { ValidationCentreView } from './client/views/ValidationCentreView';
import { ApprovalsView } from './client/views/ApprovalsView';
import { AgentsView } from './client/views/AgentsView';
import { AnalyticsView } from './client/views/AnalyticsView';
import { AuditLogsView } from './client/views/AuditLogsView';
import { IntegrationsView } from './client/views/IntegrationsView';
import { SettingsView } from './client/views/SettingsView';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { TooltipProvider } from '@/components/ui/tooltip';

type NavItem = {
  path: string;
  label: string;
  icon: typeof LayoutDashboard;
  badge?: number;
};

function parseRoute(fullPath: string): { pathname: string; searchParams: URLSearchParams } {
  const [rawPath, rawSearch = ''] = fullPath.split('?');
  let pathname = rawPath || '/dashboard';
  if (pathname === '/' || pathname === '/overview') pathname = '/dashboard';
  return { pathname, searchParams: new URLSearchParams(rawSearch) };
}

export default function App() {
  const [fullRoute, setFullRoute] = useState<string>(
    () => `${window.location.pathname}${window.location.search}`
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);

  // Crisp White Light Palette is the default for non-technical usability
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [commandOpen, setCommandOpen] = useState(false);
  const [launchOpen, setLaunchOpen] = useState(false);

  // Contextual "Ask Assistant" / "Ask Why" drawer state
  const [chatDrawerOpen, setChatDrawerOpen] = useState(false);
  const [chatFocusJourneyId, setChatFocusJourneyId] = useState<string | undefined>(undefined);
  const [chatInitialQuestion, setChatInitialQuestion] = useState<string | null>(null);
  const [chatQuestionNonce, setChatQuestionNonce] = useState(0);

  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const { pathname: route, searchParams } = parseRoute(fullRoute);

  const navigate = useCallback((target: string) => {
    const parsed = parseRoute(target);
    const nextUrl = parsed.searchParams.toString()
      ? `${parsed.pathname}?${parsed.searchParams.toString()}`
      : parsed.pathname;
    window.history.pushState({}, '', nextUrl);
    setFullRoute(nextUrl);
    setMobileMenuOpen(false);
  }, []);

  useEffect(() => {
    const onPop = () => setFullRoute(`${window.location.pathname}${window.location.search}`);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  const fetchOverview = useCallback(() => {
    api
      .getOverview()
      .then((res) => setOverview(res))
      .catch(() => {})
      .finally(() => setLoadingOverview(false));
  }, []);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview, refreshKey]);

  useEffect(() => {
    const unsub = subscribeWorkflowEvents(() => {
      setRefreshKey((k) => k + 1);
    });
    return unsub;
  }, []);

  const handleAskWhy = useCallback((journeyId: string, question: string) => {
    setChatFocusJourneyId(journeyId);
    setChatInitialQuestion(question);
    setChatQuestionNonce((n) => n + 1);
    setChatDrawerOpen(true);
  }, []);

  const pendingApprovalsCount = overview?.kpis.humanEscalations ?? 0;

  const primaryNav: NavItem[] = [
    { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/journeys', label: 'All Merchants', icon: GitBranch },
    { path: '/approvals', label: 'Approvals', icon: UserCheck, badge: pendingApprovalsCount },
    { path: '/chat', label: 'Assistant Chat', icon: MessageSquare },
  ];

  const adminNav: NavItem[] = [
    { path: '/analytics', label: 'A2A Analytics & Study', icon: BarChart3 },
    { path: '/validation', label: 'Safety Checks', icon: ShieldCheck },
    { path: '/audit', label: 'Audit History', icon: FileSearch },
    { path: '/agents', label: 'AI Assistants', icon: Bot },
    { path: '/integrations', label: 'Connected Systems', icon: Plug },
    { path: '/settings', label: 'Safety Rules', icon: Settings },
  ];

  const isAdminRoute = adminNav.some((item) => item.path === route);
  const isJourneyDetail = route.startsWith('/journeys/') && route.length > '/journeys/'.length;
  const activeJourneyId = isJourneyDetail ? route.replace('/journeys/', '') : null;
  const activeNav = [...primaryNav, ...adminNav].find(
    (n) => route === n.path || (n.path === '/journeys' && isJourneyDetail)
  );

  function renderNavList(collapsed: boolean) {
    return (
      <div className="space-y-4">
        <div className="space-y-1">
          {primaryNav.map((item) => {
            const Icon = item.icon;
            const active = route === item.path || (item.path === '/journeys' && isJourneyDetail);
            return (
              <button
                key={item.path}
                type="button"
                onClick={() => navigate(item.path)}
                title={collapsed ? item.label : undefined}
                className={`w-full flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-[#E6F7FD] text-[#002E6E] dark:bg-[#00B9F1]/15 dark:text-[#00B9F1] font-semibold'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/70'
                }`}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-[#0095D9] dark:text-[#00B9F1]' : ''}`} />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </span>
                {!collapsed && typeof item.badge === 'number' && item.badge > 0 && (
                  <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-[#D97706]/15 text-[#B45309] dark:text-[#F5B84B] tabular-nums">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* PostHog-style Collapsible Admin & Logs Group */}
        <div className="pt-2 border-t border-sidebar-border">
          {!collapsed ? (
            <button
              type="button"
              onClick={() => setAdminOpen((o) => !o)}
              aria-expanded={adminOpen || isAdminRoute}
              className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
            >
              <span>Admin &amp; Logs</span>
              {adminOpen || isAdminRoute ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>
          ) : null}

          {(collapsed || adminOpen || isAdminRoute) && (
            <div className="mt-1 space-y-1">
              {adminNav.map((item) => {
                const Icon = item.icon;
                const active = route === item.path;
                return (
                  <button
                    key={item.path}
                    type="button"
                    onClick={() => navigate(item.path)}
                    title={collapsed ? item.label : undefined}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-[#E6F7FD] text-[#002E6E] dark:bg-[#00B9F1]/15 dark:text-[#00B9F1] font-semibold'
                        : 'text-muted-foreground hover:text-foreground hover:bg-secondary/70'
                    }`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-[#0095D9] dark:text-[#00B9F1]' : ''}`} />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="min-h-screen flex bg-background text-foreground">
        <Toaster theme={theme} position="bottom-center" richColors />

        {/* Desktop Left Sidebar */}
        <aside
          className={`hidden lg:flex flex-col shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-150 ${
            sidebarCollapsed ? 'w-[68px]' : 'w-[244px]'
          }`}
        >
          <div className="h-16 px-4 flex items-center justify-between border-b border-sidebar-border">
            {!sidebarCollapsed && (
              <button
                type="button"
                onClick={() => navigate('/dashboard')}
                className="text-base font-extrabold tracking-tight whitespace-nowrap shrink-0 focus:outline-none"
              >
                <span className="text-[#002E6E] dark:text-white">Agent</span>
                <span className="text-[#00B9F1]">Bridge</span>
              </button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setSidebarCollapsed((c) => !c)}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {sidebarCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
            </Button>
          </div>

          <nav aria-label="Primary Navigation" className="flex-1 p-3 overflow-y-auto">
            {renderNavList(sidebarCollapsed)}
          </nav>

          {!sidebarCollapsed && (
            <div className="p-4 border-t border-sidebar-border text-[11px] text-muted-foreground">
              <div className="font-semibold text-[#002E6E] dark:text-white">Paytm Business Assurance</div>
              <div className="mt-0.5">7-Person Ops Workspace · Simulated</div>
            </div>
          )}
        </aside>

        {/* Mobile Drawer */}
        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetContent side="left" className="w-64 p-0 bg-sidebar text-sidebar-foreground">
            <SheetHeader className="h-16 px-4 flex-row items-center border-b border-sidebar-border space-y-0">
              <SheetTitle className="text-base font-extrabold">
                <span className="text-[#002E6E] dark:text-white">Agent</span>
                <span className="text-[#00B9F1]">Bridge</span>
              </SheetTitle>
            </SheetHeader>
            <nav aria-label="Mobile Navigation" className="p-3 overflow-y-auto">
              {renderNavList(false)}
            </nav>
          </SheetContent>
        </Sheet>

        {/* Main Workspace Column */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="h-[3px] w-full bg-gradient-to-r from-[#002E6E] via-[#0095D9] to-[#00B9F1] shrink-0" />
          <header className="h-16 shrink-0 px-4 lg:px-6 border-b border-border bg-card flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setMobileMenuOpen(true)}
                aria-label="Open navigation menu"
                className="lg:hidden"
              >
                <Menu className="w-5 h-5" />
              </Button>
              <div className="flex items-center gap-2 text-xs truncate">
                <span className="font-semibold text-foreground whitespace-nowrap">
                  {activeNav?.label ?? 'Merchant Onboarding Details'}
                </span>
                <span className="text-muted-foreground hidden sm:inline" aria-hidden="true">
                  /
                </span>
                <span className="text-[11px] text-muted-foreground hidden sm:inline whitespace-nowrap">
                  Simulated Demo Workspace
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">

              <Button
                variant="outline"
                size="sm"
                onClick={() => setCommandOpen(true)}
                aria-label="Open command search"
                className="hidden sm:inline-flex text-muted-foreground"
              >
                <Search className="w-3.5 h-3.5" />
                <span className="hidden lg:inline">Quick Search</span>
                <kbd className="font-mono text-[10px] text-muted-foreground ml-0.5">⌘K</kbd>
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setChatFocusJourneyId(activeJourneyId ?? undefined);
                  setChatDrawerOpen(true);
                }}
                aria-label="Open Assistant Chat"
                className="border-[#00B9F1]/45 text-[#002E6E] hover:bg-[#E6F7FD] dark:text-[#00B9F1] dark:hover:bg-[#14294D]"
              >
                <MessageSquare className="w-3.5 h-3.5 text-[#0095D9] dark:text-[#00B9F1]" />
                <span className="hidden sm:inline">Ask Assistant</span>
              </Button>

              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
                aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              >
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </Button>
            </div>
          </header>

          <main className="flex-1 p-4 lg:p-6 pb-20 lg:pb-20 max-w-[1600px] w-full mx-auto">
            {route === '/dashboard' && (
              <OverviewView
                data={overview}
                loading={loadingOverview}
                onNavigate={navigate}
                onAskWhy={handleAskWhy}
                onChanged={() => setRefreshKey((k) => k + 1)}
              />
            )}
            {route === '/journeys' && (
              <JourneysView
                onNavigate={navigate}
                onOpenLaunch={() => setLaunchOpen(true)}
                onAskWhy={handleAskWhy}
                onChanged={() => setRefreshKey((k) => k + 1)}
                initialAssignedTo={searchParams.get('assignedTo') ?? undefined}
                initialClusterKey={searchParams.get('clusterKey') ?? undefined}
                initialStatus={searchParams.get('status') ?? undefined}
                refreshKey={refreshKey}
              />
            )}
            {isJourneyDetail && activeJourneyId && (
              <JourneyDetailView
                journeyId={activeJourneyId}
                refreshKey={refreshKey}
                onNavigate={navigate}
                onAskWhy={handleAskWhy}
                onChanged={() => setRefreshKey((k) => k + 1)}
              />
            )}
            {route === '/chat' && (
              <ChatView
                refreshKey={refreshKey}
                onNavigate={navigate}
                onOpenLaunch={() => setLaunchOpen(true)}
                onMutated={() => setRefreshKey((k) => k + 1)}
              />
            )}
            {route === '/validation' && (
              <ValidationCentreView refreshKey={refreshKey} onNavigate={navigate} />
            )}
            {route === '/approvals' && (
              <ApprovalsView
                refreshKey={refreshKey}
                onNavigate={navigate}
                onChanged={() => setRefreshKey((k) => k + 1)}
              />
            )}
            {route === '/agents' && <AgentsView refreshKey={refreshKey} />}
            {route === '/analytics' && (
              <AnalyticsView
                refreshKey={refreshKey}
                onChanged={() => setRefreshKey((k) => k + 1)}
              />
            )}
            {route === '/audit' && (
              <AuditLogsView refreshKey={refreshKey} onNavigate={navigate} />
            )}
            {route === '/integrations' && <IntegrationsView refreshKey={refreshKey} />}
            {route === '/settings' && (
              <SettingsView onReset={() => setRefreshKey((k) => k + 1)} />
            )}
          </main>
        </div>

        <CommandPalette
          open={commandOpen}
          onOpenChange={setCommandOpen}
          onNavigate={navigate}
          onOpenLaunch={() => setLaunchOpen(true)}
        />

        <LaunchJourneyModal
          open={launchOpen}
          onClose={() => setLaunchOpen(false)}
          onCreated={(journeyId) => {
            setRefreshKey((k) => k + 1);
            navigate(`/journeys/${journeyId}`);
          }}
          onBatchCreated={() => setRefreshKey((k) => k + 1)}
        />

        {/* Bottom-Right Paytm Bot Assistant (with Start Onboarding & Navigation inside) */}
        <FloatingPaytmBot
          open={chatDrawerOpen}
          onOpenChange={setChatDrawerOpen}
          currentPath={route}
          focusJourneyId={chatFocusJourneyId ?? activeJourneyId ?? undefined}
          initialQuestion={chatInitialQuestion}
          initialQuestionNonce={chatQuestionNonce}
          onNavigate={navigate}
          onOpenLaunch={() => setLaunchOpen(true)}
          onMutated={() => setRefreshKey((k) => k + 1)}
        />
      </div>
    </TooltipProvider>
  );
}
