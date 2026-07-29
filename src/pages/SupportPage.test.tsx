import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { clearRegistry, registerExtension } from '@/extensions/registry';
import SupportPage from './SupportPage';

describe('SupportPage', () => {
  afterEach(() => {
    cleanup();
    clearRegistry();
  });

  it('renders neutral help without an installed support extension', () => {
    render(<SupportPage />);

    expect(screen.getByRole('heading', { name: 'Support' })).toBeInTheDocument();
    expect(screen.getByText(/Betreiber deiner Instanz/i)).toBeInTheDocument();
    expect(document.querySelector('script[data-widget-id]')).toBeNull();
  });

  it('renders the registered support content through the generic slot', () => {
    registerExtension('support.page-content', () => <p>Erweiterter Support</p>);

    render(<SupportPage />);

    expect(screen.getByText('Erweiterter Support')).toBeInTheDocument();
    expect(screen.queryByText(/Betreiber deiner Instanz/i)).not.toBeInTheDocument();
  });
});
