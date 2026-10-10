import { Button } from '@strapi/design-system';
import { styled } from 'styled-components';

export const PrimaryButton = styled(Button)`
  &:hover:not(:disabled):not([aria-disabled='true']) {
    background-color: ${({ theme }) => theme.colors.primary700};
    border-color: ${({ theme }) => theme.colors.primary700};
  }
`;
