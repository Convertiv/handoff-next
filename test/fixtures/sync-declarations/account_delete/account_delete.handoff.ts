import { defineReactComponent } from 'handoff-app';
import AccountDelete from './AccountDelete';

export default defineReactComponent(AccountDelete, {
  id: 'account_delete',
  name: 'Account delete',
  description: 'Delete-account danger card.',
  group: 'Account',
  type: 'block',
  entries: {
    component: './AccountDelete.tsx',
    scss: './styles.scss',
  },
  previews: {
    default: {
      title: 'Default',
      args: { heading: 'Delete account' },
    },
  },
  properties: {
    heading: {
      name: 'Heading',
      type: 'text',
      generic: 'true',
      default: 'Delete account',
    },
  },
});
