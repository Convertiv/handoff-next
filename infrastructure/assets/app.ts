#!/usr/bin/env node
import 'source-map-support/register';
import { App } from 'aws-cdk-lib';
import { HandoffAssetsStack } from './handoff-assets-stack';

/**
 * Handoff Asset Infrastructure
 *
 * Provisions:
 *   - S3 bucket (private, CORS-enabled for presigned PUT uploads)
 *   - CloudFront distribution with OAC (Origin Access Control) pointing at the bucket
 *   - IAM user with scoped S3 + CloudFront invalidation permissions
 *   - IAM access key (printed in stack outputs — copy to .env immediately)
 *
 * Deploy:
 *   cd infrastructure/assets
 *   npm install
 *   npx cdk bootstrap   # first time only, per account+region
 *   npx cdk deploy
 *
 * Optional env vars (set before running cdk deploy):
 *   CDK_DEFAULT_ACCOUNT  — AWS account ID (falls back to CDK default credential resolution)
 *   CDK_DEFAULT_REGION   — AWS region, defaults to us-east-1
 *   CORS_ORIGINS         — comma-separated allowed origins, defaults to *
 *                          e.g. "https://mydesignsystem.com,http://localhost:3000"
 *   CDN_DOMAIN_NAME      — custom domain for CloudFront (requires CDN_CERTIFICATE_ARN)
 *   CDN_CERTIFICATE_ARN  — ACM certificate ARN in us-east-1 for the custom domain
 *
 * After deploy, add these to your .env / Vercel env vars:
 *   HANDOFF_S3_BUCKET
 *   HANDOFF_S3_REGION
 *   HANDOFF_S3_CDN_URL
 *   HANDOFF_CLOUDFRONT_DISTRIBUTION_ID
 *   HANDOFF_S3_ACCESS_KEY_ID
 *   HANDOFF_S3_SECRET_ACCESS_KEY
 */

const app = new App();

new HandoffAssetsStack(app, 'HandoffAssets', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
  terminationProtection: true,
  description: 'Handoff: S3 asset storage + CloudFront CDN for the design system asset inventory',
  tags: {
    Application: 'handoff',
    Component: 'assets',
  },
  corsOrigins: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : ['*'],
  domainName: process.env.CDN_DOMAIN_NAME,
  certificateArn: process.env.CDN_CERTIFICATE_ARN,
});
