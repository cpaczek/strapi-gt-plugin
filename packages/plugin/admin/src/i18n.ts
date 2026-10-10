import { useIntl } from 'react-intl';
import { PLUGIN_ID } from '../../shared/constants';
import english from './translations/en.json';

export type MessageKey = keyof typeof english;
export const descriptor = (key: MessageKey) => ({
  id: `${PLUGIN_ID}.${key}`,
  defaultMessage: english[key],
});
export const useText = () => {
  const { formatMessage } = useIntl();
  return (key: MessageKey, values?: Record<string, string | number>) =>
    formatMessage(descriptor(key), values);
};

export const localeLabel = ({ name, code }: { name: string; code: string }): string =>
  name.endsWith(` (${code})`) ? name : `${name} (${code})`;
