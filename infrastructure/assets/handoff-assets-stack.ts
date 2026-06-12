import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface HandoffAssetsStackProps extends cdk.StackProps {
  /**
   * Custom domain name for the CloudFront distribution (e.g. "assets.mydesignsystem.com").
   * If set, certificateArn must also be provided.
   */
  domainName?: string;

  /**
   * ARN of an ACM certificate in us-east-1 covering domainName.
   * Required when domainName is set; ignored otherwise.
   */
  certificateArn?: string;

  /**
   * Allowed origins for S3 CORS — needed for presigned PUT uploads from the browser.
   * Defaults to ['*']. Tighten to your app domain(s) in production.
   * e.g. ['https://mydesignsystem.com', 'http://localhost:3000']
   */
  corsOrigins?: string[];
}

export class HandoffAssetsStack extends cdk.Stack {
  public readonly bucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: HandoffAssetsStackProps = {}) {
    super(scope, id, props);

    const { domainName, certificateArn, corsOrigins = ['*'] } = props;

    // ── S3 Bucket ─────────────────────────────────────────────────────────────
    // No public access — CloudFront reads via OAC; the app server writes via
    // presigned PUTs. All traffic is encrypted in transit and at rest.
    this.bucket = new s3.Bucket(this, 'Bucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: false,
      cors: [
        {
          // PUT is required for presigned upload URLs generated server-side.
          // GET is included so the app server can read directly if needed.
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT],
          allowedOrigins: corsOrigins,
          allowedHeaders: ['*'],
          // ETag is exposed so clients can verify upload integrity.
          exposedHeaders: ['ETag'],
          maxAge: 3000,
        },
      ],
      // RETAIN means `cdk destroy` won't delete the bucket or its contents.
      // Change to DESTROY + autoDeleteObjects: true only for ephemeral dev stacks.
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
    });

    // ── CloudFront Distribution ───────────────────────────────────────────────
    // S3BucketOrigin.withOriginAccessControl() (CDK >= 2.100) creates the OAC,
    // wires it to the origin, and grants CloudFront s3:GetObject on the bucket
    // automatically — no manual bucket policy needed for reads.
    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(this.bucket);

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        compress: true,
      },
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      ...(domainName && certificateArn
        ? {
            domainNames: [domainName],
            certificate: acm.Certificate.fromCertificateArn(this, 'Certificate', certificateArn),
          }
        : {}),
    });

    // ── IAM User ──────────────────────────────────────────────────────────────
    // One dedicated user for the Handoff application. Principle of least privilege:
    // object-level S3 access on this bucket only, and invalidation on this
    // distribution only.
    const assetUser = new iam.User(this, 'AssetUser', {
      userName: `handoff-assets-${cdk.Stack.of(this).stackName.toLowerCase()}`,
    });

    // Object read/write/delete — used by the app server for presign generation,
    // Figma sync downloads, and asset deletion.
    assetUser.addToPolicy(
      new iam.PolicyStatement({
        sid: 'S3ObjectAccess',
        effect: iam.Effect.ALLOW,
        actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
        resources: [`${this.bucket.bucketArn}/*`],
      })
    );

    // Bucket-level access — needed for list operations during admin sync jobs
    // and to verify the bucket exists on startup.
    assetUser.addToPolicy(
      new iam.PolicyStatement({
        sid: 'S3BucketAccess',
        effect: iam.Effect.ALLOW,
        actions: ['s3:ListBucket', 's3:GetBucketLocation'],
        resources: [this.bucket.bucketArn],
      })
    );

    // CloudFront invalidation — called after an asset is updated or deleted
    // so the CDN serves the new version immediately rather than waiting for TTL.
    assetUser.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CloudFrontInvalidation',
        effect: iam.Effect.ALLOW,
        actions: ['cloudfront:CreateInvalidation', 'cloudfront:GetInvalidation'],
        resources: [
          `arn:aws:cloudfront::${this.account}:distribution/${this.distribution.distributionId}`,
        ],
      })
    );

    // ── Access Key ────────────────────────────────────────────────────────────
    // The secret key is printed in CloudFormation Outputs (visible in the AWS
    // console and CLI). Copy it to your secrets manager / .env immediately after
    // deployment, then consider rotating or removing the output.
    const accessKey = new iam.CfnAccessKey(this, 'AccessKey', {
      userName: assetUser.userName,
    });

    // ── Stack Outputs ─────────────────────────────────────────────────────────
    // Copy these values directly into your .env / Vercel / hosting env vars.

    new cdk.CfnOutput(this, 'BucketName', {
      value: this.bucket.bucketName,
      description: 'HANDOFF_S3_BUCKET',
    });

    new cdk.CfnOutput(this, 'BucketRegion', {
      value: this.region,
      description: 'HANDOFF_S3_REGION',
    });

    new cdk.CfnOutput(this, 'DistributionDomain', {
      value: `https://${this.distribution.distributionDomainName}`,
      description: 'HANDOFF_S3_CDN_URL',
    });

    new cdk.CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
      description: 'HANDOFF_CLOUDFRONT_DISTRIBUTION_ID — used when calling CreateInvalidation',
    });

    new cdk.CfnOutput(this, 'AccessKeyId', {
      value: accessKey.ref,
      description: 'HANDOFF_S3_ACCESS_KEY_ID',
    });

    // This output exposes the secret in plaintext. It only appears once — rotate
    // immediately if you suspect it has been seen by unintended parties.
    new cdk.CfnOutput(this, 'SecretAccessKey', {
      value: accessKey.attrSecretAccessKey,
      description: 'HANDOFF_S3_SECRET_ACCESS_KEY — sensitive, capture and rotate after first deploy',
    });
  }
}
