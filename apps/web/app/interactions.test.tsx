// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  data: {} as Record<string, object>,
  role: 'ENGINEER',
  token: 'token',
  reload: vi.fn(),
  fetch: vi.fn(),
  login: vi.fn(),
  setAuth: vi.fn(),
  replace: vi.fn(),
  logout: vi.fn(),
  hydrate: vi.fn(),
}));
vi.mock('@/lib/useApi', () => ({
  useApi: (path: string) => ({
    data: state.data[path],
    reload: state.reload,
    loading: false,
    error: null,
    stale: false,
  }),
}));
vi.mock('@/lib/api', () => ({ apiFetch: state.fetch, login: state.login }));
vi.mock('@/lib/store', () => ({
  useAuth: (select?: (auth: object) => unknown) => {
    const auth = {
      token: state.token,
      user: { name: 'Operator', role: state.role },
      hydrated: true,
      hydrate: state.hydrate,
      logout: state.logout,
      setAuth: state.setAuth,
    };
    return select ? select(auth) : auth;
  },
  canApprove: (user: { role: string }) => ['ENGINEER', 'ADMIN'].includes(user.role),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: state.replace }),
  useParams: () => ({ id: 'INC-1' }),
  usePathname: () => '/incidents',
}));
vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: ReactNode }) => createElement('a', props, children),
}));

import Failures from './failures/page';
import IncidentDetail from './incidents/[id]/page';
import Login from './login/page';

import { Shell } from '@/components/Shell';

const incident = {
  id: 'INC-1',
  title: 'Payment delay',
  severity: 'HIGH',
  status: 'RESOLVED',
  affected_services: ['payment-service'],
  timeline: [],
  anomalies: [],
  postmortem: null,
  remediation: [
    {
      id: 'ACTION-1',
      type: 'clear_injected_fault',
      target_service: 'payment-service',
      risk: 'LOW',
      status: 'PROPOSED',
      rationale: 'clear demo fault',
    },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
  state.role = 'ENGINEER';
  state.token = 'token';
  state.data = {
    '/api/incidents/INC-1': incident,
    '/api/failures': [{ service: 'payment-service', faults: [{ type: 'db_latency', params: {} }] }],
  };
  state.fetch.mockResolvedValue({});
  state.reload.mockResolvedValue(undefined);
  vi.stubGlobal('alert', vi.fn());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('operator dashboard interactions', () => {
  it('submits edited credentials and stores the authenticated session', async () => {
    const user = { name: 'Engineer', role: 'ENGINEER' };
    state.login.mockResolvedValue({ token: 'signed-token', user });
    render(<Login />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@demo.dev' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'edited-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(state.setAuth).toHaveBeenCalledWith('signed-token', user));
    expect(state.login).toHaveBeenCalledWith('new@demo.dev', 'edited-password');
    expect(state.replace).toHaveBeenCalledWith('/dashboard');
  });
  it('shows the actual login service failure and restores the submit button', async () => {
    state.login.mockRejectedValue(new Error('too many login attempts'));
    render(<Login />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText('too many login attempts');
    expect(state.setAuth).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).disabled).toBe(
      false
    );
  });
  it.each([
    ['Run AI investigation', '/api/incidents/INC-1/investigate'],
    ['Propose remediation', '/api/incidents/INC-1/remediate'],
    ['Generate postmortem', '/api/incidents/INC-1/postmortem'],
    ['Approve', '/api/remediation/ACTION-1/approve'],
    ['Reject', '/api/remediation/ACTION-1/reject'],
  ])('sends %s to the correct guarded endpoint and refreshes evidence', async (label, path) => {
    render(<IncidentDetail />);
    fireEvent.click(screen.getByRole('button', { name: label }));
    await waitFor(() => expect(state.reload).toHaveBeenCalledOnce());
    expect(state.fetch).toHaveBeenCalledWith(path, { method: 'POST', body: '{}' });
  });
  it('reports a rejected action without claiming new evidence', async () => {
    state.fetch.mockRejectedValue(new Error('action already decided'));
    render(<IncidentDetail />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('action already decided'));
    expect(state.reload).not.toHaveBeenCalled();
  });
  it('disables viewer mutations while preserving incident evidence', () => {
    state.role = 'VIEWER';
    render(<IncidentDetail />);
    expect(
      (screen.getByRole('button', { name: 'Run AI investigation' }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.getByText('Requires ENGINEER/ADMIN approval.')).toBeTruthy();
  });
  it('injects and clears only the selected demo service fault', async () => {
    render(<Failures />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Inject' })[0]!);
    await waitFor(() => expect(state.reload).toHaveBeenCalledOnce());
    expect(state.fetch).toHaveBeenCalledWith(
      '/api/failures/db-latency',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ service: 'payment-service', params: { targetMs: 2500 } }),
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(state.reload).toHaveBeenCalledTimes(2));
    expect(state.fetch).toHaveBeenLastCalledWith('/api/failures/payment-service', {
      method: 'DELETE',
    });
  });
  it('reports failed injection and clearing without refreshing to a false clean state', async () => {
    state.fetch.mockRejectedValue(new Error('service unreachable'));
    render(<Failures />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Inject' })[0]!);
    await waitFor(() => expect(window.alert).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(window.alert).toHaveBeenCalledTimes(2));
    expect(state.reload).not.toHaveBeenCalled();
  });
  it('hydrates the session, signs out, and redirects unauthenticated visits', async () => {
    const view = render(<Shell>Private evidence</Shell>);
    expect(state.hydrate).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(state.logout).toHaveBeenCalledOnce();
    expect(state.replace).toHaveBeenCalledWith('/login');
    state.token = '';
    view.rerender(<Shell>Private evidence</Shell>);
    await waitFor(() => expect(screen.queryByText('Private evidence')).toBeNull());
  });
});
