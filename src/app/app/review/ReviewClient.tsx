'use client';

import Layout from '../../components/Layout/Main';
import ReviewQueueClient from '../../components/Review/ReviewQueueClient';

export default function ReviewClient({
  config,
  menu,
  message,
}: {
  config: any;
  menu: any;
  message?: string;
}) {
  const layoutMeta = { metaTitle: 'Review queue', metaDescription: 'Pages submitted for review' };

  return (
    <Layout config={config} menu={menu} current={null} metadata={layoutMeta}>
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-1 text-xl font-semibold">Review queue</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Pages submitted for review — including pages built through a guest share link by people without an
          account.
        </p>
        {message ? <p className="text-sm text-muted-foreground">{message}</p> : <ReviewQueueClient />}
      </div>
    </Layout>
  );
}
