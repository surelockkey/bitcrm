# BitCRM Backend

Locksmith business management platform — backend monorepo.

## Architecture

- **4 NestJS microservices**: user (4001), crm (4002), deal (4003), inventory (4004)
- **Shared package**: DynamoDB, Redis, Auth (Cognito), error handling
- **Infrastructure**: Terraform for AWS Cognito, Docker for local DynamoDB + Redis

## Quick Start

```bash
# Install dependencies
npm install

# Start local infrastructure (DynamoDB + Redis)
npm run setup

# Start all services
npm run dev

# Start a single service
npm run dev:user
```

## API Docs

Each service exposes Scalar API docs:

- <http://localhost:4001/api/users/docs>
- <http://localhost:4002/api/crm/docs>
- <http://localhost:4003/api/deals/docs>
- <http://localhost:4004/api/inventory/docs>

Unified docs: <http://localhost:4001/api/docs>

## Terraform (Cognito)

```bash
cd infra/dev
terraform init
terraform plan
terraform apply
```

Copy outputs to `.env`.
