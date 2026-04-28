import { redirect } from 'next/navigation';

export default function TokensIndexRedirect() {
  redirect('/system');
}
