import { Button } from '@strapi/design-system';
import { styled } from 'styled-components';

export const PrimaryButton = styled(Button)`
  /* Interpolating disabled and enabled colors crosses unreadable contrast ratios. */
  transition-property: border-color;

  &:hover:not(:disabled):not([aria-disabled='true']),
  &:active:not(:disabled):not([aria-disabled='true']) {
    background-color: ${({ theme }) => theme.colors.buttonPrimary600};
    border-color: ${({ theme }) => theme.colors.buttonPrimary600};
  }
`;
