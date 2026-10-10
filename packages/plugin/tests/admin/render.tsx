import type { ReactNode } from 'react';
import { vi } from 'vitest';

// jsdom has no layout observer; browser acceptance covers actual geometry.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);
import { render } from '@testing-library/react';
import { DesignSystemProvider } from '@strapi/design-system';
import { IntlProvider } from 'react-intl';

export const renderAdmin = (children: ReactNode) =>
  render(
    <DesignSystemProvider>
      <IntlProvider locale="en">{children}</IntlProvider>
    </DesignSystemProvider>
  );

if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
vi.stubGlobal(
  'IntersectionObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);
