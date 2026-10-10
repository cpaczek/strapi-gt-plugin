import { useId, type ReactNode, type ChangeEvent } from 'react';
import {
  Alert,
  Box,
  Checkbox,
  Field,
  Flex,
  Loader,
  SingleSelect,
  SingleSelectOption,
  TextInput,
  Typography,
} from '@strapi/design-system';
import type { Diagnostic } from '../../../shared/contracts';
import { useText } from '../i18n';

export const Section = ({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) => (
  <Box tag="section" background="neutral0" padding={6} hasRadius shadow="filterShadow">
    <Flex direction="column" alignItems="stretch" gap={5}>
      <Typography tag="h2" variant="delta">
        {title}
      </Typography>
      {description && <Typography textColor="neutral600">{description}</Typography>}
      {children}
    </Flex>
  </Box>
);
export const TextField = ({
  label,
  value,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  hint?: string;
}) => (
  <Field.Root hint={hint}>
    <Field.Label>{label}</Field.Label>
    <TextInput
      value={value}
      disabled={disabled}
      onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
    />
    <Field.Hint />
  </Field.Root>
);
export const SelectField = ({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) => {
  const text = useText();
  return (
    <Field.Root>
      <Field.Label>{label}</Field.Label>
      <SingleSelect
        value={value}
        disabled={disabled}
        placeholder={text('common.select')}
        onChange={(next: string | number) => {
          if (typeof next === 'string') onChange(next);
        }}
      >
        {options.map((option) => (
          <SingleSelectOption key={option.value} value={option.value}>
            {option.label}
          </SingleSelectOption>
        ))}
      </SingleSelect>
      <Field.Error />
    </Field.Root>
  );
};
export const Toggle = ({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) => {
  const id = useId();
  return (
    <Flex gap={3}>
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next: boolean | 'indeterminate') => onChange(next === true)}
      />
      <Typography tag="label" htmlFor={id}>
        {label}
      </Typography>
    </Flex>
  );
};
export const Notice = ({ diagnostic }: { diagnostic: Diagnostic }) => {
  const text = useText();
  return (
    <Alert
      role={diagnostic.level === 'error' ? 'alert' : 'status'}
      variant={diagnostic.level === 'error' ? 'danger' : diagnostic.level}
      closeLabel={text('common.dismiss')}
    >
      {diagnostic.text}
    </Alert>
  );
};
export const Loading = () => {
  const text = useText();
  return (
    <Flex padding={6} justifyContent="center">
      <Loader>{text('common.loading')}</Loader>
    </Flex>
  );
};
