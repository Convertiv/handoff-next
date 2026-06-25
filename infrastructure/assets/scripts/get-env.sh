#!/usr/bin/env bash
# get-env.sh
#
# Query the deployed HandoffAssets CloudFormation stack and print the env vars
# you need to set in Vercel (or your .env file). Run after `npm run deploy`.
#
# Usage:
#   npm run get-env
#   ./scripts/get-env.sh [--stack STACK_NAME] [--profile AWS_PROFILE] [--region REGION]
#
# Examples:
#   ./scripts/get-env.sh
#   ./scripts/get-env.sh --profile handoff --region us-east-1
#   ./scripts/get-env.sh --stack HandoffAssets-prod

set -euo pipefail

STACK_NAME="HandoffAssets"
PROFILE=""
REGION="${CDK_DEFAULT_REGION:-us-east-1}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stack)   STACK_NAME="$2"; shift 2 ;;
    --profile) PROFILE="$2";    shift 2 ;;
    --region)  REGION="$2";     shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

AWS_ARGS="--region $REGION"
[[ -n "$PROFILE" ]] && AWS_ARGS="$AWS_ARGS --profile $PROFILE"

echo ""
echo "Fetching outputs from CloudFormation stack: $STACK_NAME ($REGION)"
echo ""

OUTPUTS=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  $AWS_ARGS \
  --query "Stacks[0].Outputs" \
  --output json 2>/dev/null || true)

if [[ -z "$OUTPUTS" || "$OUTPUTS" == "null" ]]; then
  echo "ERROR: Stack '$STACK_NAME' not found or has no outputs." >&2
  echo "Have you run: npm run deploy?" >&2
  exit 1
fi

extract() {
  echo "$OUTPUTS" | python3 -c \
    "import sys,json; o={x['OutputKey']:x['OutputValue'] for x in json.load(sys.stdin)}; print(o.get('$1',''))"
}

BUCKET=$(extract "BucketName")
REGION_OUT=$(extract "BucketRegion")
CDN_URL=$(extract "DistributionDomain")
DIST_ID=$(extract "DistributionId")
KEY_ID=$(extract "AccessKeyId")
SECRET=$(extract "SecretAccessKey")

cat <<EOF
┌──────────────────────────────────────────────────────────────────────┐
│  Vercel env vars — copy to Project Settings → Environment Variables  │
└──────────────────────────────────────────────────────────────────────┘

HANDOFF_S3_BUCKET=$BUCKET
HANDOFF_S3_REGION=$REGION_OUT
HANDOFF_S3_CDN_URL=$CDN_URL
HANDOFF_CLOUDFRONT_DISTRIBUTION_ID=$DIST_ID
HANDOFF_S3_ACCESS_KEY_ID=$KEY_ID
HANDOFF_S3_SECRET_ACCESS_KEY=$SECRET

EOF

echo "⚠  Mark HANDOFF_S3_SECRET_ACCESS_KEY as a Secret in Vercel."
echo ""
echo "Vercel CLI — add all vars to production at once:"
echo ""
cat <<EOF
vercel env add HANDOFF_S3_BUCKET production <<< "$BUCKET"
vercel env add HANDOFF_S3_REGION production <<< "$REGION_OUT"
vercel env add HANDOFF_S3_CDN_URL production <<< "$CDN_URL"
vercel env add HANDOFF_CLOUDFRONT_DISTRIBUTION_ID production <<< "$DIST_ID"
vercel env add HANDOFF_S3_ACCESS_KEY_ID production <<< "$KEY_ID"
vercel env add HANDOFF_S3_SECRET_ACCESS_KEY production <<< "$SECRET"
EOF
echo ""
