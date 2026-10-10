import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { DesignSystemProvider } from '@strapi/design-system';
import { IntlProvider } from 'react-intl';

export const renderAdmin = (children: ReactNode) =>
  render(
    <DesignSystemProvider>
      <IntlProvider locale="en">{children}</IntlProvider>
    </DesignSystemProvider>
  );
