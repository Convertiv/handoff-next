# Handoff Asset Infrastructure

CDK stack that provisions the S3 + CloudFront infrastructure for Handoff's asset
storage — image fills, thumbnails, logos, and other binary assets uploaded during
a Figma fetch.

## What gets provisioned

- **S3 bucket** — private, OAC-gated (no public access), CORS-enabled for presigned PUT uploads
- **CloudFront distribution** — TLS 1.2+, HTTP/2+3, aggressively cached; optionally on a custom domain
- **IAM user** — scoped to `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` on this bucket and `cloudfront:CreateInvalidation` on this distribution
- **IAM access key** — printed in stack outputs; copy to Vercel immediately

## Prerequisites

- **Node.js** ≥ 18
- **AWS CLI** configured with credentials that have `AdministratorAccess` (or equivalent CDK deploy permissions)
- No global CDK CLI required — the local `node_modules/.bin/cdk` is used via npm scripts

## Deploy

```bash
cd infrastructure/assets
npm install

# First time only — bootstraps the CDK toolkit in your AWS account + region
CDK_DEFAULT_ACCOUNT=123456789012 CDK_DEFAULT_REGION=us-east-1 npm run bootstrap

# Deploy the stack
CDK_DEFAULT_ACCOUNT=123456789012 CDK_DEFAULT_REGION=us-east-1 npm run deploy
```

### Optional env vars

Set these before running `npm run deploy` to customise the stack:

| Variable | Required | Description |
|---|---|---|
| `CDK_DEFAULT_ACCOUNT` | Yes | AWS account ID |
| `CDK_DEFAULT_REGION` | No | AWS region (default: `us-east-1`) |
| `CORS_ORIGINS` | No | Comma-separated allowed origins for presigned uploads (default: `*`). Tighten to your app domain in production, e.g. `https://myapp.vercel.app,http://localhost:3000` |
| `CDN_DOMAIN_NAME` | No | Custom CloudFront domain, e.g. `cdn.handoff.com`. Requires `CDN_CERTIFICATE_ARN` |
| `CDN_CERTIFICATE_ARN` | No | ARN of an ACM certificate in `us-east-1` for `CDN_DOMAIN_NAME` |

Example with custom domain:
```bash
CDK_DEFAULT_ACCOUNT=581159614562 \
CDK_DEFAULT_REGION=us-east-1 \
CDN_DOMAIN_NAME=cdn.handoff.com \
CDN_CERTIFICATE_ARN=arn:aws:acm:us-east-1:581159614562:certificate/abc-123 \
CORS_ORIGINS=https://ssc.vercel.app,http://localhost:3000 \
npm run deploy
```

## Get Vercel env vars

After deploying, run:

```bash
npm run get-env
# or with an AWS profile:
./scripts/get-env.sh --profile handoff
```

This queries the CloudFormation stack outputs and prints everything ready to paste:

```
┌──────────────────────────────────────────────────────────────────────┐
│  Vercel env vars — copy to Project Settings → Environment Variables  │
└──────────────────────────────────────────────────────────────────────┘

HANDOFF_S3_BUCKET=handoffassets-bucket83908e77-abc123
HANDOFF_S3_REGION=us-east-1
HANDOFF_S3_CDN_URL=https://d1abc123.cloudfront.net
HANDOFF_CLOUDFRONT_DISTRIBUTION_ID=E1ABC123EXAMPLE
HANDOFF_S3_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
HANDOFF_S3_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

Mark `HANDOFF_S3_SECRET_ACCESS_KEY` as a **Secret** in Vercel.

## How it integrates with handoff-app

When the S3 env vars are present in the Vercel deployment, the Figma fetch pipeline
automatically uploads image fills to S3 instead of storing blobs in Postgres:

1. Figma fetch completes — tokens, icons, component data written normally
2. For each image fill: buffer downloaded from Figma CDN (never touches `/tmp`)
3. 200px thumbnail generated in-memory with sharp
4. Original + thumbnail uploaded to S3 in parallel
5. CDN URLs stored in `handoff_asset.storage_url` and `handoff_asset.thumbnail_url`

Without S3 configured, fills fall back to DB blob storage served via
`/api/handoff/assets/{id}/raw` — useful for local development.

## Asset key scheme

Keys are content-addressed (SHA-256 of the image bytes), so the same image stored
by two different registries deduplicates automatically:

```
fills/img_<sha256_12>.{ext}          original
fills/thumbs/img_<sha256_12>.png     200px thumbnail
assets/<assetId>.{ext}               manually uploaded assets
assets/thumbs/<assetId>.png          manual upload thumbnails
```

## npm scripts

| Script | Description |
|---|---|
| `npm run bootstrap` | Bootstrap CDK toolkit (run once per account/region) |
| `npm run deploy` | Deploy or update the stack |
| `npm run diff` | Preview changes without deploying |
| `npm run synth` | Print the synthesised CloudFormation template |
| `npm run get-env` | Print Vercel env vars from stack outputs |
| `npm run destroy` | Tear down the stack (bucket is RETAINED — manual delete required) |
