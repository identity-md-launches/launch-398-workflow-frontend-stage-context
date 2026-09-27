import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { WagmiProvider, type Config } from 'wagmi';
import { Notice } from './components/ui';
import { loadDeployment, type Deployment, type LoadOptions } from './deployment';
import { Page } from './Page';
import { createAppConfig, type ConfigOverrides } from './wagmi';

export interface AppProps {
  /** Test hooks; production passes nothing and loads ./imd-deployment.json next to index.html. */
  loadOptions?: LoadOptions;
  configOverrides?: ConfigOverrides;
}

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; deployment: Deployment; config: Config };

export function App({ loadOptions, configOverrides }: AppProps = {}) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const queryClient = useMemo(() => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } }), []);

  useEffect(() => {
    let cancelled = false;
    loadDeployment(loadOptions ?? {})
      .then((deployment) => {
        if (cancelled) return;
        setState({ status: 'ready', deployment, config: createAppConfig(deployment, configOverrides ?? {}) });
      })
      .catch((error: Error) => {
        if (!cancelled) setState({ status: 'error', message: error.message });
      });
    return () => {
      cancelled = true;
    };
  }, [loadOptions, configOverrides]);

  if (state.status === 'loading') {
    return (
      <main id="main" className="page page-center">
        <p role="status" aria-busy="true">Loading deployment configuration…</p>
      </main>
    );
  }
  if (state.status === 'error') {
    return (
      <main id="main" className="page page-center">
        <Notice tone="danger" role="alert" title="This page cannot start">
          <p>{state.message}</p>
          <p>The site ships a deployment file beside index.html; if it is missing or altered the page refuses to show contract controls. Reload, or rebuild the site from source.</p>
        </Notice>
      </main>
    );
  }
  return (
    <WagmiProvider config={state.config}>
      <QueryClientProvider client={queryClient}>
        <Page deployment={state.deployment} />
      </QueryClientProvider>
    </WagmiProvider>
  );
}
